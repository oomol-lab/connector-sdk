import { describe, expect, it, vi } from "vitest";
import { ConnectorError, isRetryable } from "../src/index";
import { ok, projectRecorder } from "./helpers";

const BASE = "https://connector.oomol.com/v1";

/** A minimal connection-request wire payload (gateway shape: `externalUserId` + `alias`). */
function requestPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "cr_1",
    status: "initiated",
    projectId: "proj_1",
    providerConfigId: "pc_1",
    externalUserId: "user_42",
    service: "gmail",
    alias: "work",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth?state=cr_1",
    connectedAccountId: null,
    errorCode: null,
    errorMessage: null,
    expiresAt: "2026-06-25T00:10:00.000Z",
    createdAt: 1_750_000_000_000,
    updatedAt: 1_750_000_000_000,
    ...overrides,
  };
}

/** A minimal connected-account wire payload. */
function accountPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "ca_1",
    connectedAccountId: "ca_1",
    projectId: "proj_1",
    providerConfigId: "pc_1",
    externalUserId: "user_42",
    alias: "work",
    appId: "app_1",
    status: "active",
    available: true,
    service: "openai",
    providerAccountId: "acct_x",
    accountLabel: "OpenAI (work)",
    createdAt: 1_750_000_000_000,
    updatedAt: 1_750_000_000_000,
    ...overrides,
  };
}

describe("ProjectConnector — connect", () => {
  it("connect.oauth POSTs the link endpoint, sends wire `userId`/`alias`, returns connectionName", async () => {
    const { project, calls } = projectRecorder(() => ok(requestPayload()));
    const req = await project.connect.oauth("user_42", {
      service: "gmail",
      connectionName: "work",
      returnUri: "https://app.example.com/done",
    });

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${BASE}/saas/connected-accounts/link`);
    // SDK `externalUserId` serializes to the wire `userId`; `connectionName` → wire `alias`.
    expect(calls[0]!.body).toEqual({
      userId: "user_42",
      service: "gmail",
      alias: "work",
      returnUri: "https://app.example.com/done",
    });
    // Response `alias` is surfaced as `connectionName`; `externalUserId` is preserved.
    expect(req.connectionName).toBe("work");
    expect(req.externalUserId).toBe("user_42");
    expect(req.authorizationUrl).toContain("state=cr_1");
    expect("alias" in req).toBe(false);
  });

  it("connect.oauth omits `alias` and `returnUri` when not provided; accepts providerConfigId", async () => {
    const { project, calls } = projectRecorder(() => ok(requestPayload({ alias: null })));
    const req = await project.connect.oauth("user_42", { providerConfigId: "pc_9" });

    expect(calls[0]!.body).toEqual({ userId: "user_42", providerConfigId: "pc_9" });
    expect(req.connectionName).toBeNull();
  });

  it("connect.apiKey POSTs the api-key endpoint with apiKey + extra and returns a ConnectedAccount", async () => {
    const { project, calls } = projectRecorder(() => ok(accountPayload()));
    const acct = await project.connect.apiKey("user_42", {
      service: "openai",
      apiKey: "sk-secret",
      connectionName: "work",
      extra: { region: "us" },
    });

    expect(calls[0]!.url).toBe(`${BASE}/saas/connected-accounts/api-key`);
    expect(calls[0]!.body).toEqual({
      userId: "user_42",
      service: "openai",
      alias: "work",
      apiKey: "sk-secret",
      extra: { region: "us" },
    });
    expect(acct.connectionName).toBe("work");
    expect(acct.connectedAccountId).toBe("ca_1");
    expect(acct.available).toBe(true);
    expect("alias" in acct).toBe(false);
  });

  it("connect.customCredential POSTs the custom-credential endpoint with values", async () => {
    const { project, calls } = projectRecorder(() => ok(accountPayload({ service: "jira", alias: null })));
    const acct = await project.connect.customCredential("user_42", {
      service: "jira",
      values: { email: "a@b.com", token: "t" },
    });

    expect(calls[0]!.url).toBe(`${BASE}/saas/connected-accounts/custom-credential`);
    expect(calls[0]!.body).toEqual({
      userId: "user_42",
      service: "jira",
      values: { email: "a@b.com", token: "t" },
    });
    expect(acct.connectionName).toBeNull();
  });
});

describe("ProjectConnector — getConnectionRequest", () => {
  it("GETs the connection-request endpoint with an encoded id and renames alias", async () => {
    const { project, calls } = projectRecorder(() =>
      ok(requestPayload({ status: "connected", connectedAccountId: "ca_1" })),
    );
    const req = await project.getConnectionRequest("cr id/1");

    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${BASE}/saas/connection-requests/cr%20id%2F1`);
    expect(req.status).toBe("connected");
    expect(req.connectionName).toBe("work");
    expect(req.connectedAccountId).toBe("ca_1");
  });
});

describe("ProjectConnector — execute", () => {
  it("derives `service` from the actionId prefix and returns the nested output", async () => {
    const { project, calls } = projectRecorder(() =>
      ok({ executionId: "exec-1", actionId: "gmail.search_threads", output: { threads: [1, 2] } }),
    );
    const out = await project.execute("user_42", "gmail.search_threads", { query: "from:boss" });

    expect(calls[0]!.url).toBe(`${BASE}/saas/actions/gmail.search_threads`);
    expect(calls[0]!.body).toEqual({
      userId: "user_42",
      service: "gmail",
      input: { query: "from:boss" },
    });
    expect(out).toEqual({ threads: [1, 2] });
  });

  it("prefers an explicit providerConfigId and does NOT also send a derived service", async () => {
    const { project, calls } = projectRecorder(() => ok({ executionId: "e", actionId: "gmail.x", output: {} }));
    await project.execute("user_42", "gmail.search_threads", { query: "q" }, { providerConfigId: "pc_7" });

    expect(calls[0]!.body).toEqual({
      userId: "user_42",
      providerConfigId: "pc_7",
      input: { query: "q" },
    });
    expect((calls[0]!.body as Record<string, unknown>).service).toBeUndefined();
  });

  it("sends an explicit `service` override instead of the actionId-derived prefix", async () => {
    const { project, calls } = projectRecorder(() => ok({ executionId: "e", actionId: "gmail.x", output: {} }));
    await project.execute("user_42", "gmail.search_threads", { query: "q" }, { service: "gmail_custom" });
    expect((calls[0]!.body as Record<string, unknown>).service).toBe("gmail_custom");
  });

  it("connectionName becomes the wire `alias` account selector", async () => {
    const { project, calls } = projectRecorder(() => ok({ executionId: "e", actionId: "gmail.x", output: {} }));
    await project.execute("user_42", "gmail.search_threads", { query: "q" }, { connectionName: "work" });

    expect(calls[0]!.body).toEqual({
      userId: "user_42",
      service: "gmail",
      alias: "work",
      input: { query: "q" },
    });
  });

  it("connectedAccountId wins over connectionName (at most one account selector ships)", async () => {
    const { project, calls } = projectRecorder(() => ok({ executionId: "e", actionId: "gmail.x", output: {} }));
    await project.execute(
      "user_42",
      "gmail.search_threads",
      { query: "q" },
      { connectedAccountId: "ca_9", connectionName: "work" },
    );

    const body = calls[0]!.body as Record<string, unknown>;
    expect(body.connectedAccountId).toBe("ca_9");
    expect(body.alias).toBeUndefined();
  });

  it("executeRaw surfaces the nested executionId / actionId / message metadata", async () => {
    const { project } = projectRecorder(() =>
      ok({ executionId: "exec-99", actionId: "gmail.search_threads", output: { ok: true } }),
    );
    const raw = await project.executeRaw("user_42", "gmail.search_threads", { query: "q" });

    expect(raw.data).toEqual({ ok: true });
    expect(raw.executionId).toBe("exec-99");
    expect(raw.actionId).toBe("gmail.search_threads");
    expect(raw.message).toBe("OK");
  });

  it("executeRaw falls back to the path actionId when the response omits it", async () => {
    const { project } = projectRecorder(() => ok({ executionId: "exec-7", output: { ok: true } }));
    const raw = await project.executeRaw("user_42", "gmail.search_threads", { query: "q" });
    expect(raw.actionId).toBe("gmail.search_threads");
    expect(raw.executionId).toBe("exec-7");
  });
});

describe("ProjectConnector — forUser scoped sub-client", () => {
  it("binds the externalUserId so connect/execute drop it, and exposes it as a getter", async () => {
    const { project, calls } = projectRecorder((call) =>
      call.url.includes("/actions/")
        ? ok({ executionId: "e", actionId: "gmail.x", output: { ok: 1 } })
        : ok(requestPayload()),
    );
    const user = project.forUser("user_77");
    expect(user.externalUserId).toBe("user_77");

    await user.connect.oauth({ service: "gmail", connectionName: "work" });
    await user.execute("gmail.search_threads", { query: "q" }, { connectionName: "work" });

    expect(calls[0]!.body).toEqual({ userId: "user_77", service: "gmail", alias: "work" });
    expect(calls[1]!.body).toEqual({
      userId: "user_77",
      service: "gmail",
      alias: "work",
      input: { query: "q" },
    });
  });

  it("binds the externalUserId across apiKey / customCredential / executeRaw too", async () => {
    const { project, calls } = projectRecorder((call) =>
      call.url.includes("/actions/")
        ? ok({ executionId: "e", actionId: "openai.x", output: { ok: 1 } })
        : ok(accountPayload({ externalUserId: "user_88" })),
    );
    const user = project.forUser("user_88");

    await user.connect.apiKey({ service: "openai", apiKey: "sk-x" });
    await user.connect.customCredential({ service: "jira", values: { token: "t" } });
    const raw = await user.executeRaw("openai.complete", { prompt: "hi" });

    expect(calls[0]!.body).toEqual({ userId: "user_88", service: "openai", apiKey: "sk-x" });
    expect(calls[1]!.body).toEqual({ userId: "user_88", service: "jira", values: { token: "t" } });
    expect(calls[2]!.body).toEqual({ userId: "user_88", service: "openai", input: { prompt: "hi" } });
    expect(raw.executionId).toBe("e");
  });

  it("exposes getConnectionRequest / waitForConnection on the scoped client, routed through the project seam", async () => {
    const statuses = ["initiated", "connected"];
    const { project, calls } = projectRecorder((_call, attempt) => ok(requestPayload({ status: statuses[attempt] })));
    const user = project.forUser("user_99");

    const got = await user.getConnectionRequest("cr_1");
    expect(got.status).toBe("initiated");
    const done = await user.waitForConnection("cr_1");
    expect(done.status).toBe("connected");

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.method === "GET" && c.headers["authorization"] === "Bearer oo_proj_test")).toBe(true);
  });
});

describe("ProjectConnector — waitForConnection", () => {
  it("polls until a terminal status, sleeping between polls, and returns the connected request", async () => {
    const statuses = ["initiated", "initiated", "connected"];
    const { project, calls, sleeps } = projectRecorder((_call, attempt) =>
      ok(requestPayload({ status: statuses[attempt], connectedAccountId: attempt === 2 ? "ca_1" : null })),
    );

    const req = await project.waitForConnection("cr_1", { pollIntervalMs: 1234 });

    expect(req.status).toBe("connected");
    expect(req.connectedAccountId).toBe("ca_1");
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(sleeps).toEqual([1234, 1234]); // slept after the two non-terminal polls only
  });

  it("accepts a ConnectionRequest object and returns on a `failed` terminal status", async () => {
    const { project, calls } = projectRecorder(() =>
      ok(requestPayload({ status: "failed", errorCode: "provider_error", errorMessage: "nope" })),
    );
    const pending = await project.getConnectionRequest("cr_1");
    const done = await project.waitForConnection(pending);

    expect(done.status).toBe("failed");
    expect(done.errorCode).toBe("provider_error");
    expect(calls).toHaveLength(2); // one get + one poll
  });

  it("returns (does not throw) when the request has naturally expired", async () => {
    // The gateway flips an unfinished `initiated` request to `expired` after expiresAt; that is a
    // terminal status the wait must RETURN, not loop on or throw.
    const { project, calls } = projectRecorder(() => ok(requestPayload({ status: "expired" })));
    const done = await project.waitForConnection("cr_1");
    expect(done.status).toBe("expired");
    expect(calls).toHaveLength(1);
  });

  it("routes every poll through the project request seam (auth header on each GET)", async () => {
    const statuses = ["initiated", "connected"];
    const { project, calls } = projectRecorder((_call, attempt) => ok(requestPayload({ status: statuses[attempt] })));
    await project.waitForConnection("cr_1");
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.method === "GET" && c.headers["authorization"] === "Bearer oo_proj_test")).toBe(true);
  });

  it("throws a non-retryable client_wait_timeout when maxWaitMs elapses before completion", async () => {
    const { project } = projectRecorder(() => ok(requestPayload({ status: "initiated" })));
    await expect(
      project.waitForConnection("cr_1", { maxWaitMs: 0 }),
    ).rejects.toMatchObject({ code: "client_wait_timeout", status: 0 });

    try {
      await project.waitForConnection("cr_1", { maxWaitMs: 0 });
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorError);
      expect(isRetryable(err)).toBe(false);
    }
  });

  it("clamps the final poll sleep to the remaining maxWaitMs budget", async () => {
    // Fake timers so each injected sleep deterministically advances the clock waitForConnection reads.
    vi.useFakeTimers();
    try {
      const { project, sleeps } = projectRecorder(() => ok(requestPayload({ status: "initiated" })), undefined, {
        sleep: async (ms) => {
          vi.advanceTimersByTime(ms);
        },
      });
      await expect(
        project.waitForConnection("cr_1", { pollIntervalMs: 1000, maxWaitMs: 1500 }),
      ).rejects.toMatchObject({ code: "client_wait_timeout" });
      // A full interval, then the final sleep CLAMPED to the 500ms remaining — never a second full
      // interval past the deadline. A regression to plain pollIntervalMs would record [1000, 1000].
      expect(sleeps).toEqual([1000, 500]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts mid-wait: rejects with AbortError and stops polling once the signal fires during a sleep", async () => {
    const controller = new AbortController();
    const { project, calls } = projectRecorder(() => ok(requestPayload({ status: "initiated" })), undefined, {
      sleep: async () => controller.abort(),
    });

    await expect(
      project.waitForConnection("cr_1", { signal: controller.signal, pollIntervalMs: 10 }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(1);
  });

  it("rejects with the standard AbortError and sends no request when the signal is already aborted", async () => {
    const { project, calls } = projectRecorder(() => ok(requestPayload()));
    const controller = new AbortController();
    controller.abort();

    await expect(
      project.waitForConnection("cr_1", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toHaveLength(0);
  });
});

describe("ProjectConnector — headers", () => {
  it("authenticates with the project key and sends no personal-path headers", async () => {
    const { project, calls } = projectRecorder(() => ok(requestPayload()), { apiKey: "oo_proj_secret" });
    await project.connect.oauth("user_42", { service: "gmail" });

    expect(calls[0]!.headers["authorization"]).toBe("Bearer oo_proj_secret");
    // The project client never carries the personal connection selector nor an organization header.
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBeUndefined();
    expect(calls[0]!.headers["x-oo-organization-name"]).toBeUndefined();
    expect(calls[0]!.headers["content-type"]).toBe("application/json");
    expect(calls[0]!.headers["user-agent"]).toMatch(/^@oomol-lab\/connector\//);
  });

  it("throws a client_invalid_request when apiKey is missing", () => {
    expect(() => projectRecorder(() => ok(requestPayload()), { apiKey: "" })).toThrow(ConnectorError);
    try {
      projectRecorder(() => ok(requestPayload()), { apiKey: "" });
    } catch (err) {
      expect(err).toMatchObject({ code: "client_invalid_request", status: 0 });
    }
  });
});
