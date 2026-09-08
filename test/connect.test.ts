import { describe, expect, it, vi } from "vitest";
import { ConnectorError, isRetryable, OpenConnector } from "../src/index";
import { fail, ok, openRecorder, recorder } from "./helpers";

const BASE = "https://connector.oomol.com/v1";
const OPEN_BASE = "http://localhost:3000";

/** The start payload both backends return from `POST …/connect`. */
function startPayload(overrides: Record<string, unknown> = {}) {
  return {
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=st_1",
    stateHandle: "st_1",
    connectionRequestId: "cr_1",
    status: "initiated",
    expiresAt: "2026-09-07T00:10:00.000Z",
    ...overrides,
  };
}

/** The attempt payload both backends return from `GET …/connection-requests/:id`. */
function attemptPayload(overrides: Record<string, unknown> = {}) {
  return {
    connectionRequestId: "cr_1",
    service: "gmail",
    status: "initiated",
    appId: null,
    errorCode: null,
    errorMessage: null,
    expiresAt: "2026-09-07T00:10:00.000Z",
    createdAt: 1_757_000_000_000,
    updatedAt: 1_757_000_000_000,
    ...overrides,
  };
}

/** A connection as the wire spells it (`alias`), which the SDK renames to `connectionName`. */
function appPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "app_1",
    service: "openai",
    status: "active",
    alias: "openai-1",
    authType: "api_key",
    displayName: "OpenAI",
    isDefault: true,
    ...overrides,
  };
}

describe("connect.oauth — hosted", () => {
  it("POSTs to /v1/connections/{service}/connect and returns the start payload verbatim", async () => {
    const { oomol, calls } = recorder(() => ok(startPayload()));
    const start = await oomol.connect.oauth("gmail");

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${BASE}/connections/gmail/connect`);
    expect(calls[0]!.headers["authorization"]).toBe("Bearer test-key");
    expect(start).toEqual(startPayload());
    // `connectionRequestId` is the poll handle; `stateHandle` is the one-shot callback state.
    expect(start.connectionRequestId).toBe("cr_1");
  });

  it("sends an EMPTY body when no input is given (both backends accept `{}`)", async () => {
    const { oomol, calls } = recorder(() => ok(startPayload()));
    await oomol.connect.oauth("gmail");
    expect(calls[0]!.body).toEqual({});
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
  });

  it("passes returnUri / authorizationOptionIds / extra / secretExtra through", async () => {
    const { oomol, calls } = recorder(() => ok(startPayload()));
    await oomol.connect.oauth("gitlab", {
      returnUri: "https://app.example.com/done",
      authorizationOptionIds: ["repo", "read_user"],
      extra: { instanceUrl: "https://gitlab.example.com" },
      secretExtra: { clientSecret: "s3cr3t" },
    });
    expect(calls[0]!.body).toEqual({
      returnUri: "https://app.example.com/done",
      authorizationOptionIds: ["repo", "read_user"],
      extra: { instanceUrl: "https://gitlab.example.com" },
      secretExtra: { clientSecret: "s3cr3t" },
    });
  });

  it("omits keys the caller left undefined rather than sending nulls", async () => {
    const { oomol, calls } = recorder(() => ok(startPayload()));
    await oomol.connect.oauth("gmail", { returnUri: "https://app.example.com/done", extra: undefined });
    expect(calls[0]!.body).toEqual({ returnUri: "https://app.example.com/done" });
  });

  it("percent-encodes the service in the path", async () => {
    const { oomol, calls } = recorder(() => ok(startPayload()));
    await oomol.connect.oauth("weird/service");
    expect(calls[0]!.url).toBe(`${BASE}/connections/weird%2Fservice/connect`);
  });

  it("carries team + per-call options like any other request", async () => {
    const { oomol, calls } = recorder(() => ok(startPayload()), { team: "acme" });
    await oomol.connect.oauth("gmail", {}, { team: "other-team" });
    expect(calls[0]!.headers["x-oo-team-name"]).toBe("other-team");
  });

  it("surfaces a permission failure as the typed error (a plain member cannot connect)", async () => {
    const { oomol } = recorder(() => fail("invalid_input", 403, { message: "team manager role required" }));
    await expect(oomol.connect.oauth("gmail")).rejects.toMatchObject({
      name: "ConnectorError",
      code: "invalid_input",
      status: 403,
      message: "team manager role required",
    });
  });

  it("surfaces a missing OAuth client config (409 user_oauth_client_required)", async () => {
    const { oomol } = recorder(() => fail("user_oauth_client_required", 409, { message: "Configure an OAuth client first." }));
    await expect(oomol.connect.oauth("gmail")).rejects.toMatchObject({ code: "user_oauth_client_required", status: 409 });
  });
});

describe("connect.apiKey / connect.customCredential — hosted", () => {
  it("apiKey POSTs the credential and renames the wire `alias` to `connectionName`", async () => {
    const { oomol, calls } = recorder(() => ok(appPayload()));
    const app = await oomol.connect.apiKey("openai", { apiKey: "sk-live-123" });

    expect(calls[0]!.url).toBe(`${BASE}/connections/openai/connect/api-key`);
    expect(calls[0]!.body).toEqual({ apiKey: "sk-live-123" });
    expect(app.connectionName).toBe("openai-1");
    expect("alias" in app).toBe(false);
    expect(app.id).toBe("app_1");
  });

  it("apiKey forwards `extra` and `comment` only when given", async () => {
    const { oomol, calls } = recorder(() => ok(appPayload()));
    await oomol.connect.apiKey("posthog", { apiKey: "phx_1", extra: { baseUrl: "https://eu.posthog.com" }, comment: "EU project" });
    expect(calls[0]!.body).toEqual({
      apiKey: "phx_1",
      extra: { baseUrl: "https://eu.posthog.com" },
      comment: "EU project",
    });
  });

  it("apiKey accepts an explicit null comment (the backend allows string | null)", async () => {
    const { oomol, calls } = recorder(() => ok(appPayload()));
    await oomol.connect.apiKey("openai", { apiKey: "sk-1", comment: null });
    expect(calls[0]!.body).toEqual({ apiKey: "sk-1", comment: null });
  });

  it("customCredential POSTs the field values and returns the ready connection", async () => {
    const { oomol, calls } = recorder(() => ok(appPayload({ service: "jira", authType: "custom_credential", alias: null })));
    const app = await oomol.connect.customCredential("jira", { values: { email: "a@b.c", token: "t", site: "acme" } });

    expect(calls[0]!.url).toBe(`${BASE}/connections/jira/connect/custom-credential`);
    expect(calls[0]!.body).toEqual({ values: { email: "a@b.c", token: "t", site: "acme" } });
    expect(app.connectionName).toBeNull();
  });

  it("tolerates a null data payload, yielding just the renamed name", async () => {
    const { oomol } = recorder(() => ok(null));
    await expect(oomol.connect.apiKey("openai", { apiKey: "sk-1" })).resolves.toEqual({ connectionName: null });
  });

  it("surfaces a rejected credential field as the typed error", async () => {
    const { oomol } = recorder(() => fail("invalid_input", 400, { message: "unknown credential field: nope" }));
    await expect(oomol.connect.customCredential("jira", { values: { nope: "x" } })).rejects.toMatchObject({
      code: "invalid_input",
      status: 400,
    });
  });
});

describe("connect.getAttempt — hosted", () => {
  it("GETs /v1/connection-requests/{id} and returns the attempt", async () => {
    const { oomol, calls } = recorder(() => ok(attemptPayload({ status: "connected", appId: "app_9" })));
    const attempt = await oomol.connect.getAttempt("cr_1");

    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${BASE}/connection-requests/cr_1`);
    expect(attempt.status).toBe("connected");
    expect(attempt.appId).toBe("app_9");
  });

  it("percent-encodes the id", async () => {
    const { oomol, calls } = recorder(() => ok(attemptPayload()));
    await oomol.connect.getAttempt("cr/1");
    expect(calls[0]!.url).toBe(`${BASE}/connection-requests/cr%2F1`);
  });

  it("surfaces an unknown id as connection_request_not_found", async () => {
    const { oomol } = recorder(() => fail("connection_request_not_found", 404));
    await expect(oomol.connect.getAttempt("nope")).rejects.toMatchObject({
      code: "connection_request_not_found",
      status: 404,
    });
  });
});

describe("connect.waitForConnection", () => {
  it("polls until the attempt leaves `initiated`, then returns it", async () => {
    let n = 0;
    const { oomol, calls, sleeps } = recorder(() => {
      n++;
      return ok(n < 3 ? attemptPayload() : attemptPayload({ status: "connected", appId: "app_9" }));
    });
    const done = await oomol.connect.waitForConnection("cr_1");

    expect(done.status).toBe("connected");
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2000, 2000]);
  });

  it("accepts the start payload directly (no need to unwrap the id)", async () => {
    const { oomol, calls } = recorder(() => ok(attemptPayload({ status: "connected", appId: "app_9" })));
    const start = { connectionRequestId: "cr_7" } as never;
    await oomol.connect.waitForConnection(start);
    expect(calls[0]!.url).toBe(`${BASE}/connection-requests/cr_7`);
  });

  it("returns a `failed` attempt instead of throwing (the user declined, or it was superseded)", async () => {
    const { oomol } = recorder(() =>
      ok(attemptPayload({ status: "failed", errorCode: "request_superseded", errorMessage: "superseded" })),
    );
    const done = await oomol.connect.waitForConnection("cr_1");
    expect(done.status).toBe("failed");
    expect(done.errorCode).toBe("request_superseded");
  });

  it("returns an `expired` attempt instead of throwing (the user never finished)", async () => {
    const { oomol } = recorder(() => ok(attemptPayload({ status: "expired" })));
    await expect(oomol.connect.waitForConnection("cr_1")).resolves.toMatchObject({ status: "expired" });
  });

  it("honors a custom pollIntervalMs", async () => {
    let n = 0;
    const { oomol, sleeps } = recorder(() => ok(n++ === 0 ? attemptPayload() : attemptPayload({ status: "connected" })));
    await oomol.connect.waitForConnection("cr_1", { pollIntervalMs: 250 });
    expect(sleeps).toEqual([250]);
  });

  it("throws client_wait_timeout once maxWaitMs elapses, carrying the last attempt seen", async () => {
    vi.useFakeTimers();
    try {
      const { oomol } = recorder(() => ok(attemptPayload()), {}, { sleep: async () => {
          vi.advanceTimersByTime(2000);
        } });
      const err = await oomol.connect.waitForConnection("cr_1", { maxWaitMs: 5000 }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConnectorError);
      expect(err).toMatchObject({ code: "client_wait_timeout", status: 0 });
      expect((err as ConnectorError).data).toMatchObject({ connectionRequestId: "cr_1", status: "initiated" });
      expect(isRetryable(err)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps each poll's own timeout to the remaining budget", async () => {
    vi.useFakeTimers();
    // `send` arms its per-attempt timeout with `setTimeout(…, spec.timeoutMs)`, and the injected
    // sleep never uses a timer — so the recorded delays ARE the per-poll timeouts, in order.
    const armed = vi.spyOn(globalThis, "setTimeout");
    try {
      let n = 0;
      const { oomol } = recorder(
        () => ok(n++ === 0 ? attemptPayload() : attemptPayload({ status: "connected" })),
        { timeoutMs: 30_000 },
        { sleep: async () => {
          vi.advanceTimersByTime(2000);
        } },
      );
      // A 3s budget must never let a 30s per-request timeout run past the cap: the first poll gets
      // the full 3s, and the second — after the 2s inter-poll sleep — only the 1s still left.
      await oomol.connect.waitForConnection("cr_1", { maxWaitMs: 3000 });
      expect(armed.mock.calls.map(([, ms]) => ms)).toEqual([3000, 1000]);
    } finally {
      armed.mockRestore();
      vi.useRealTimers();
    }
  });

  it("disables transport retries per poll, so no backoff can outlive maxWaitMs", async () => {
    // `send`'s backoff and `Retry-After` waits sit OUTSIDE its per-attempt timeout, so a retrying
    // poll could resume past the cap. The wait retries instead, one poll at a time.
    const { oomol, calls, sleeps } = recorder((_call, attempt) =>
      attempt === 0 ? fail("rate_limited", 429, { headers: { "retry-after": "60" } }) : ok(attemptPayload({ status: "connected" })),
    );
    const settled = await oomol.connect.waitForConnection("cr_1", { pollIntervalMs: 250 });

    expect(settled.status).toBe("connected");
    // Two polls, and the only wait between them is the loop's own 250ms — never the 60s Retry-After.
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([250]);
  });

  it("surfaces the failure when every poll failed and the budget ran out", async () => {
    vi.useFakeTimers();
    try {
      const { oomol } = recorder(() => fail("upstream_unavailable", 503), {}, { sleep: async () => {
        vi.advanceTimersByTime(2000);
      } });
      // A wait that never once reached the server reports THAT, not a bare client_wait_timeout.
      await expect(oomol.connect.waitForConnection("cr_1", { maxWaitMs: 3000 })).rejects.toMatchObject({
        code: "upstream_unavailable",
        status: 503,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops at a poll failure no retry can fix", async () => {
    const { oomol, calls } = recorder(() => fail("connection_request_not_found", 404));
    await expect(oomol.connect.waitForConnection("cr_nope")).rejects.toMatchObject({
      code: "connection_request_not_found",
      status: 404,
    });
    expect(calls).toHaveLength(1);
  });

  it("keeps the last attempt seen when a later poll fails and the budget runs out", async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const { oomol } = recorder(
        () => (n++ === 0 ? ok(attemptPayload()) : fail("internal_error", 500)),
        {},
        { sleep: async () => {
          vi.advanceTimersByTime(2000);
        } },
      );
      const err = await oomol.connect.waitForConnection("cr_1", { maxWaitMs: 5000 }).catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "client_wait_timeout", status: 0 });
      expect((err as ConnectorError).data).toMatchObject({ connectionRequestId: "cr_1", status: "initiated" });
      // The blip that ended the wait is preserved as the cause, not swallowed.
      expect((err as ConnectorError).cause).toMatchObject({ code: "internal_error", status: 500 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects with AbortError when the caller's signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { oomol, calls } = recorder(() => ok(attemptPayload()));
    await expect(oomol.connect.waitForConnection("cr_1", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(calls).toHaveLength(0);
  });

  it("stops polling when the signal aborts mid-wait", async () => {
    const controller = new AbortController();
    const { oomol } = recorder(() => {
      controller.abort();
      return ok(attemptPayload());
    });
    await expect(oomol.connect.waitForConnection("cr_1", { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("connect — self-hosted runtime", () => {
  it("uses the same paths under the /v1 prefix on the runtime origin", async () => {
    const { open, calls } = openRecorder(() => ok(startPayload()), { adminToken: "adm_1" });
    await open.connect.oauth("gmail", { returnUri: "http://localhost:5173/done" });

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${OPEN_BASE}/v1/connections/gmail/connect`);
    expect(calls[0]!.body).toEqual({ returnUri: "http://localhost:5173/done" });
  });

  it("authenticates connection management with the ADMIN token, not the runtime token", async () => {
    const { open, calls } = openRecorder(() => ok(startPayload()), { runtimeToken: "oct_1", adminToken: "adm_1" });
    await open.connect.oauth("gmail");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer adm_1");
  });

  it("keeps sending the RUNTIME token on the runtime surface", async () => {
    const { open, calls } = openRecorder(() => ok({ ok: true, runtime: "oomol-connect" }), {
      runtimeToken: "oct_1",
      adminToken: "adm_1",
    });
    await open.health();
    expect(calls[0]!.headers["authorization"]).toBe("Bearer oct_1");
  });

  it("sends NO auth header for management when no adminToken is configured", async () => {
    // A runtime with no admin token accepts these openly; sending the runtime token instead would
    // just earn a confusing 401, so the client sends nothing.
    const { open, calls } = openRecorder(() => ok(startPayload()), { runtimeToken: "oct_1" });
    await open.connect.oauth("gmail");
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
  });

  it("apiKey / customCredential hit the runtime's connect routes and rename `alias`", async () => {
    const { open, calls } = openRecorder(() => ok(appPayload({ alias: "work" })), { adminToken: "adm_1" });
    const app = await open.connect.apiKey("openai", { apiKey: "sk-1", extra: { baseUrl: "https://api.openai.com" } });
    expect(calls[0]!.url).toBe(`${OPEN_BASE}/v1/connections/openai/connect/api-key`);
    expect(app.connectionName).toBe("work");

    const custom = openRecorder(() => ok(appPayload({ alias: null })), { adminToken: "adm_1" });
    await custom.open.connect.customCredential("jira", { values: { token: "t" } });
    expect(custom.calls[0]!.url).toBe(`${OPEN_BASE}/v1/connections/jira/connect/custom-credential`);
  });

  it("getAttempt / waitForConnection poll the runtime's connection-requests route", async () => {
    let n = 0;
    const { open, calls, sleeps } = openRecorder(
      () => ok(n++ === 0 ? attemptPayload() : attemptPayload({ status: "connected", appId: "app_9" })),
      { adminToken: "adm_1" },
    );
    const done = await open.connect.waitForConnection("cr_1", { pollIntervalMs: 10 });
    expect(calls[0]!.url).toBe(`${OPEN_BASE}/v1/connection-requests/cr_1`);
    expect(calls[0]!.headers["authorization"]).toBe("Bearer adm_1");
    expect(done.appId).toBe("app_9");
    expect(sleeps).toEqual([10]);
  });

  it("surfaces the runtime's 401 when a runtime token is used where admin is required", async () => {
    const { open } = openRecorder(
      () =>
        new Response(JSON.stringify({ error: { code: "unauthorized", message: "A valid administrator bearer token is required." } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      { adminToken: "oct_wrong" },
    );
    await expect(open.connect.oauth("gmail")).rejects.toMatchObject({ code: "unauthorized", status: 401 });
  });

  it("rejects an empty adminToken at construction", () => {
    expect(() => new OpenConnector({ adminToken: "" })).toThrow(ConnectorError);
    expect(() => new OpenConnector({ adminToken: 42 as never })).toThrow(/adminToken/);
  });
});

describe("connect — client shape", () => {
  it("is a reserved member on both clients, not a service namespace", async () => {
    const { oomol } = recorder(() => ok(startPayload()));
    const { open } = openRecorder(() => ok(startPayload()));
    for (const api of [oomol.connect, open.connect]) {
      expect(typeof api.oauth).toBe("function");
      expect(typeof api.apiKey).toBe("function");
      expect(typeof api.customCredential).toBe("function");
      expect(typeof api.getAttempt).toBe("function");
      expect(typeof api.waitForConnection).toBe("function");
    }
  });

  it("survives `using()` scoping on the hosted client", async () => {
    const { oomol, calls } = recorder(() => ok(startPayload()), {});
    await oomol.using({ team: "acme" }).connect.oauth("gmail");
    expect(calls[0]!.headers["x-oo-team-name"]).toBe("acme");
  });

  it("cannot be replaced on the frozen runtime client", () => {
    const { open } = openRecorder(() => ok(startPayload()));
    expect(() => {
      (open as unknown as { connect: unknown }).connect = null;
    }).toThrow(TypeError);
  });
});
