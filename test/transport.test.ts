import { describe, expect, it } from "vitest";
import { defaultTransport, send, type RequestSpec, type Transport } from "../src/http";
import { ok, recorder } from "./helpers";

describe("transport — non-JSON bodies", () => {
  it("treats a 2xx non-JSON body as success and surfaces the raw text as data", async () => {
    const { oomol } = recorder(
      () => new Response("plain text OK", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const data = await oomol.execute("svc.act", {});
    expect(data).toBe("plain text OK");
  });

  it("maps a non-2xx non-JSON body to a provider_error carrying the real status", async () => {
    const { oomol } = recorder(
      () => new Response("<html>502 Bad Gateway</html>", { status: 502 }),
      { maxRetries: 0 },
    );
    await expect(oomol.execute("svc.act", {})).rejects.toMatchObject({
      code: "provider_error",
      status: 502,
    });
  });
});

describe("transport — non-envelope JSON normalization", () => {
  it("treats a bare 2xx JSON object (no `success` discriminator) as the data payload itself", async () => {
    const payload = { id: "github:default", configured: true };
    const { oomol } = recorder(() => new Response(JSON.stringify(payload), { status: 200 }));
    const data = await oomol.execute("svc.act", {});
    expect(data).toEqual(payload);
  });

  it("treats bare 2xx JSON arrays and primitives as the data payload too", async () => {
    const bodies = [JSON.stringify([1, 2, 3]), "true"];
    const { oomol } = recorder((call) => new Response(bodies[Number(call.url.includes("second"))], { status: 200 }));
    expect(await oomol.execute("svc.act", {})).toEqual([1, 2, 3]);
    expect(await oomol.execute("svc.second", {})).toBe(true);
  });

  it("maps the runtime middleware `{ error: { code, message } }` failure shape to its code and message", async () => {
    const { oomol } = recorder(
      () =>
        new Response(JSON.stringify({ error: { code: "unknown_service", message: "Unknown service: nope." } }), {
          status: 404,
        }),
      { maxRetries: 0 },
    );
    await expect(oomol.execute("svc.act", {})).rejects.toMatchObject({
      code: "unknown_service",
      status: 404,
      message: "Unknown service: nope.",
    });
  });

  it("keeps a top-level `message` and carries the body as data for unrecognized non-2xx JSON", async () => {
    const { oomol } = recorder(
      () => new Response(JSON.stringify({ message: "gateway melted", hint: 42 }), { status: 503 }),
      { maxRetries: 0 },
    );
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err.code).toBe("provider_error"); // no code in the body; derived from the status family
    expect(err.status).toBe(503);
    expect(err.message).toBe("gateway melted");
    expect(err.data).toEqual({ message: "gateway melted", hint: 42 });
  });

  it("rejects malformed runtime error shapes (non-string code, missing message) into the fallback path", async () => {
    // Both near-misses of `{ error: { code, message } }` must degrade to the status-derived code
    // with the body preserved as data — never a crash or a half-mapped error.
    const bodies = [{ error: { code: 404, message: "x" } }, { error: { code: "x" } }];
    for (const body of bodies) {
      const { oomol } = recorder(() => new Response(JSON.stringify(body), { status: 404 }), { maxRetries: 0 });
      const err = await oomol.execute("svc.act", {}).catch((e) => e);
      expect(err.code).toBe("provider_error");
      expect(err.status).toBe(404);
      expect(err.data).toEqual(body);
    }
  });

  it("treats a 2xx body shaped like a runtime error as success data (error mapping is non-2xx only)", async () => {
    const body = { error: { code: "x", message: "y" } };
    const { oomol } = recorder(() => new Response(JSON.stringify(body), { status: 200 }));
    expect(await oomol.execute("svc.act", {})).toEqual(body);
  });
});

describe("transport — retries clamping", () => {
  it("a negative retries count makes exactly one attempt (no fall-through to the final throw)", async () => {
    const { oomol, calls } = recorder(() => ok({ done: true }));
    const data = await oomol.execute("svc.act", {}, { retries: -1 });
    expect(data).toEqual({ done: true });
    expect(calls).toHaveLength(1);
  });
});

describe("transport — defaultTransport.sleep", () => {
  it("resolves after a real timer when no signal is given", async () => {
    await expect(defaultTransport.sleep(5)).resolves.toBeUndefined();
  });

  it("resolves immediately when the signal is already aborted (no pending timer)", async () => {
    const ac = new AbortController();
    ac.abort();
    // A 10s delay would hang the test if the pre-aborted short-circuit were missing.
    await expect(defaultTransport.sleep(10_000, ac.signal)).resolves.toBeUndefined();
  });

  it("clears its timer and resolves early when the signal aborts mid-wait", async () => {
    const ac = new AbortController();
    const pending = defaultTransport.sleep(10_000, ac.signal);
    ac.abort();
    // Resolves via the abort listener (clearTimeout + resolve), not the 10s timer.
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("transport — empty & status-derived envelopes", () => {
  it("treats an empty 2xx body as a success carrying null data", async () => {
    // Empty body → parseBody returns undefined → send synthesizes { success: true, data: null }.
    const { oomol } = recorder(() => new Response("", { status: 200 }));
    const data = await oomol.execute("svc.act", {});
    expect(data).toBeNull();
  });

  it("maps a 429 without an errorCode to rate_limited from the status alone", async () => {
    const { oomol } = recorder(() => new Response("too many", { status: 429 }), { maxRetries: 0 });
    await expect(oomol.execute("svc.act", {})).rejects.toMatchObject({
      code: "rate_limited",
      status: 429,
    });
  });

  it("synthesizes a message and provider_error code for an empty error body", async () => {
    // Empty non-2xx body → undefined envelope → both message and errorCode are derived.
    const { oomol } = recorder(() => new Response("", { status: 500 }), { maxRetries: 0 });
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err.code).toBe("provider_error");
    expect(err.status).toBe(500);
    expect(err.message).toContain("Request failed with status 500");
    expect(err.message).toContain("provider_error");
  });
});

describe("transport — send cancellation window", () => {
  it("short-circuits the retry wait when the signal aborts between fetch and sleep", async () => {
    const controller = new AbortController();
    let slept = false;
    // The body read aborts the caller signal, landing cancellation in the narrow window after
    // fetch resolves but before the retry wait starts. sleepOrAbort must see an already-aborted
    // signal and return without sleeping; the loop top then throws AbortError (no second attempt).
    const res = {
      ok: false,
      status: 429,
      headers: new Headers(),
      text: async () => {
        controller.abort();
        return JSON.stringify({ success: false, errorCode: "rate_limited", data: null });
      },
    } as unknown as Response;
    const transport = {
      fetch: async () => res,
      sleep: async () => {
        slept = true;
      },
    } as unknown as Transport;
    const spec: RequestSpec = {
      method: "POST",
      url: "https://example.test/v1/actions/svc.act",
      headers: {},
      body: {},
      retries: 3,
      timeoutMs: 1000,
      signal: controller.signal,
    };
    const err = await send(spec, transport).catch((e) => e);
    expect(err.name).toBe("AbortError");
    expect(slept).toBe(false);
  });
});

describe("transport — header injection guard", () => {
  it("rejects CR/LF in a header value before sending, as a non-retryable client error", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    await expect(
      oomol.execute("svc.act", {}, { organization: "org\r\nX-Evil: 1" }),
    ).rejects.toMatchObject({ code: "client_invalid_request", status: 0 });
    expect(calls).toHaveLength(0);
  });
});
