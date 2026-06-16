import { describe, expect, it } from "vitest";
import { ConnectorError } from "../src/index";
import { fail, ok, recorder } from "./helpers";

// A real (non-mocked) sleep, for tests that must let a Retry-After wait actually start.
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("M1 — retry", () => {
  it("retries on 429 then succeeds, honoring Retry-After", async () => {
    let n = 0;
    const { oomol, calls, sleeps } = recorder(() => {
      n++;
      return n === 1
        ? fail("rate_limited", 429, { headers: { "retry-after": "2" } })
        : ok({ done: true });
    });
    const data = await oomol.execute("svc.act", {});
    expect(data).toEqual({ done: true });
    expect(calls).toHaveLength(2);
    expect(sleeps[0]).toBe(2000); // Retry-After: 2s
  });

  it("retries on 5xx up to maxRetries then throws", async () => {
    const { oomol, calls } = recorder(() => fail("provider_error", 503), { maxRetries: 2 });
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.status).toBe(503);
    expect(calls).toHaveLength(3); // 1 + 2 retries
  });

  it("retries on network error (fetch throws) then succeeds", async () => {
    let n = 0;
    const { oomol, calls } = recorder(() => {
      n++;
      if (n === 1) throw new TypeError("network down");
      return ok({ ok: 1 });
    });
    const data = await oomol.execute("svc.act", {});
    expect(data).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("retries a 429 even when its errorCode is not itself a retryable code", async () => {
    let n = 0;
    const { oomol, calls } = recorder(() => {
      n++;
      // status 429 but a code absent from RETRYABLE_CODES → retried via the status heuristic.
      return n === 1 ? fail("provider_error", 429) : ok({ ok: 1 });
    });
    const data = await oomol.execute("svc.act", {});
    expect(data).toEqual({ ok: 1 });
    expect(calls).toHaveLength(2);
  });

  it("does NOT retry on 4xx (invalid_input)", async () => {
    const { oomol, calls } = recorder(() => fail("invalid_input", 400), { maxRetries: 3 });
    await oomol.execute("svc.act", {}).catch(() => {});
    expect(calls).toHaveLength(1);
  });

  it("per-call `retries: 0` disables retry", async () => {
    const { oomol, calls } = recorder(() => fail("rate_limited", 429), { maxRetries: 5 });
    await oomol.execute("svc.act", {}, { retries: 0 }).catch(() => {});
    expect(calls).toHaveLength(1);
  });

  it("clamps an absurd Retry-After to the 60s ceiling", async () => {
    let n = 0;
    const { oomol, sleeps } = recorder(() => {
      n++;
      return n === 1 ? fail("rate_limited", 429, { headers: { "retry-after": "600" } }) : ok({});
    });
    await oomol.execute("svc.act", {});
    expect(sleeps[0]).toBe(60_000); // 600s clamped to 60s
  });

  it("uses exponential backoff when no Retry-After is present", async () => {
    const { oomol, sleeps } = recorder(() => fail("provider_error", 500), { maxRetries: 2 });
    await oomol.execute("svc.act", {}).catch(() => {});
    expect(sleeps).toHaveLength(2);
    // full jitter in [0, base*2^attempt]: attempt0 ≤ 200, attempt1 ≤ 400
    expect(sleeps[0]).toBeLessThanOrEqual(200);
    expect(sleeps[1]).toBeLessThanOrEqual(400);
  });

  it("honors a Retry-After given as an HTTP-date", async () => {
    let n = 0;
    const { oomol, calls, sleeps } = recorder(() => {
      n++;
      // A non-numeric value exercises the Date.parse branch of retryAfterMs.
      const when = new Date(Date.now() + 10_000).toUTCString();
      return n === 1
        ? fail("rate_limited", 429, { headers: { "retry-after": when } })
        : ok({ done: true });
    });
    const data = await oomol.execute("svc.act", {});
    expect(data).toEqual({ done: true });
    expect(calls).toHaveLength(2);
    // ~10s out: well above any backoff (≤200ms), confirming the date path was taken.
    expect(sleeps[0]).toBeGreaterThan(1000);
    expect(sleeps[0]).toBeLessThanOrEqual(60_000);
  });

  it("ignores an unparseable Retry-After and falls back to backoff", async () => {
    let n = 0;
    const { oomol, sleeps } = recorder(() => {
      n++;
      // Neither a number nor a parseable date → retryAfterMs returns undefined.
      return n === 1
        ? fail("rate_limited", 429, { headers: { "retry-after": "not-a-date" } })
        : ok({});
    });
    await oomol.execute("svc.act", {});
    expect(sleeps[0]).toBeLessThanOrEqual(200); // backoffDelay(0) ∈ [0, 200]
  });

  it("forwards a live caller signal through a retry wait that completes normally", async () => {
    const controller = new AbortController();
    let n = 0;
    const { oomol, calls } = recorder(
      () => {
        n++;
        return n === 1 ? fail("rate_limited", 429) : ok({ done: true });
      },
      {},
      { sleep: realSleep }, // let the wait actually run so it resolves without an abort
    );
    // The never-aborted signal drives sleepOrAbort's signal-present branch to its
    // normal completion (removeEventListener + resolve), not the abort short-circuit.
    const data = await oomol.execute("svc.act", {}, { signal: controller.signal });
    expect(data).toEqual({ done: true });
    expect(calls).toHaveLength(2);
  });
});

describe("M1 — cancellation & timeout", () => {
  it("a pre-aborted signal rejects immediately with AbortError and sends nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const { oomol, calls } = recorder(
      () => new Promise<Response>(() => {}), // never resolves
    );
    const err = await oomol.execute("svc.act", {}, { signal: controller.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AbortError");
    expect(calls).toHaveLength(0);
  });

  it("a non-Error abort reason still surfaces as a standard AbortError", async () => {
    const controller = new AbortController();
    controller.abort("stop now"); // reason is a string, not an Error instance
    const { oomol, calls } = recorder(() => new Promise<Response>(() => {}));
    const err = await oomol.execute("svc.act", {}, { signal: controller.signal }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AbortError");
    expect(calls).toHaveLength(0);
  });

  it("aborting mid-flight rejects and does not retry", async () => {
    const controller = new AbortController();
    // The fetch never resolves on its own; the signal-aware mock rejects on abort.
    const { oomol, calls } = recorder(() => new Promise<Response>(() => {}), { maxRetries: 3 });
    const p = oomol.execute("svc.act", {}, { signal: controller.signal }).catch((e) => e);
    setTimeout(() => controller.abort(), 1);
    const err = await p;
    expect(err.name).toBe("AbortError");
    expect(calls).toHaveLength(1); // no retry after caller abort
  });

  it("aborting during a retry sleep bails out promptly without another attempt", async () => {
    const controller = new AbortController();
    const { oomol, calls } = recorder(
      () => fail("rate_limited", 429, { headers: { "retry-after": "5" } }),
      { maxRetries: 3 },
      { sleep: realSleep },
    );
    const start = Date.now();
    const p = oomol.execute("svc.act", {}, { signal: controller.signal }).catch((e) => e);
    setTimeout(() => controller.abort(), 20);
    const err = await p;
    expect(err.name).toBe("AbortError");
    expect(calls).toHaveLength(1); // only the first attempt; no retry after abort
    expect(Date.now() - start).toBeLessThan(1000); // did NOT wait out the 5s Retry-After
  });

  it("client-side timeout maps to client_timeout (retries disabled)", async () => {
    // The fetch never resolves; the SDK's own timeout AbortController fires at timeoutMs,
    // and the signal-aware mock rejects with that TimeoutError reason.
    const { oomol } = recorder(() => new Promise<Response>(() => {}), {
      maxRetries: 0,
      timeoutMs: 10,
    });
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("client_timeout");
  });
});
