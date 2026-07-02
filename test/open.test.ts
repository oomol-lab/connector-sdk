import { describe, expect, it, vi } from "vitest";
import { ConnectorError, OpenConnector } from "../src/index";
import { fail, ok, openRecorder, runtimeFail } from "./helpers";

const BASE = "http://localhost:3000";

/** A minimal runtime connected-app payload (wire shape: `alias`). */
function appPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "github:default",
    service: "github",
    status: "active",
    alias: "default",
    authType: "api_key",
    displayName: "Octocat",
    accountLabel: "Octocat",
    isDefault: true,
    scopes: ["repo"],
    ...overrides,
  };
}

describe("OpenConnector — config & auth", () => {
  it("defaults the base url to the local runtime origin and sends NO auth header without a token", async () => {
    const { open, calls } = openRecorder(() => ok({ ok: true, runtime: "oomol-connect" }));
    await open.health();

    expect(calls[0]!.url).toBe(`${BASE}/v1/health`);
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    expect(calls[0]!.headers["user-agent"]).toMatch(/^@oomol-lab\/connector\//);
    expect(calls[0]!.headers["accept"]).toBe("application/json");
  });

  it("strips trailing slashes from a custom baseUrl", async () => {
    const { open, calls } = openRecorder(() => ok({ ok: true, runtime: "oomol-connect" }), {
      baseUrl: "http://192.168.1.7:3199//",
    });
    await open.health();
    expect(calls[0]!.url).toBe("http://192.168.1.7:3199/v1/health");
  });

  it("sends the runtime token as a bearer on every call", async () => {
    const { open, calls } = openRecorder(() => ok([]), { runtimeToken: "oct_r" });
    await open.apps.list();
    expect(calls[0]!.headers["authorization"]).toBe("Bearer oct_r");
  });

  it("throws a client_invalid_request for a provided-but-empty runtimeToken", () => {
    expect(() => openRecorder(() => ok(null), { runtimeToken: "" })).toThrow(ConnectorError);
    try {
      openRecorder(() => ok(null), { runtimeToken: "" });
    } catch (err) {
      expect(err).toMatchObject({ code: "client_invalid_request", status: 0 });
    }
  });

  it("constructs with no config at all", async () => {
    const { OpenConnector } = await import("../src/index");
    expect(() => new OpenConnector()).not.toThrow();
  });

  it("honors an injected `fetch`", async () => {
    const fetchImpl = vi.fn(async () => ok({ ok: true, runtime: "oomol-connect" }));
    const open = new (await import("../src/index")).OpenConnector({ fetch: fetchImpl as unknown as typeof fetch });
    const health = await open.health();
    expect(health.runtime).toBe("oomol-connect");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("OpenConnector — execute", () => {
  it("POSTs the runtime action endpoint with `{ input }` and returns the envelope data", async () => {
    const { open, calls } = openRecorder(() =>
      ok({ story_ids: [1, 2] }, { executionId: "run-1", actionId: "hackernews.get_top_stories" }),
    );
    const out = await open.execute("hackernews.get_top_stories", { limit: 2 });

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${BASE}/v1/actions/hackernews.get_top_stories`);
    expect(calls[0]!.body).toEqual({ input: { limit: 2 } });
    expect(out).toEqual({ story_ids: [1, 2] });
  });

  it("carries the connection selector header, per-call name beating the client default", async () => {
    const { open, calls } = openRecorder(() => ok({}, { executionId: "e", actionId: "github.x" }), {
      connectionName: "work",
    });
    await open.execute("github.get_current_user", {});
    await open.execute("github.get_current_user", {}, { connectionName: "personal" });

    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("work");
    expect(calls[1]!.headers["x-oo-connector-alias"]).toBe("personal");
  });

  it("sends no selector header when neither per-call nor client-level name is set", async () => {
    const { open, calls } = openRecorder(() => ok({}, { executionId: "e", actionId: "github.x" }));
    await open.execute("github.get_current_user", {});
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBeUndefined();
  });

  it("executeRaw surfaces executionId / actionId / message from the envelope meta", async () => {
    const { open } = openRecorder(() => ok({ n: 1 }, { executionId: "run-9", actionId: "github.get_current_user" }));
    const raw = await open.executeRaw("github.get_current_user", {});

    expect(raw.data).toEqual({ n: 1 });
    expect(raw.executionId).toBe("run-9");
    expect(raw.actionId).toBe("github.get_current_user");
    expect(raw.message).toBe("OK");
  });

  it("executeRaw falls back to the path actionId when the response meta omits it", async () => {
    const { open } = openRecorder(() => ok({ n: 1 }));
    const raw = await open.executeRaw("github.get_current_user", {});
    expect(raw.actionId).toBe("github.get_current_user");
    expect(raw.executionId).toBeUndefined();
  });

  it("maps a runtime failure envelope to a ConnectorError with its errorCode / meta", async () => {
    const { open } = openRecorder(() =>
      fail("connection_not_found", 404, {
        message: "github connection not found: work.",
        meta: { actionId: "github.get_current_user" },
      }),
    );
    await expect(open.execute("github.get_current_user", {}, { connectionName: "work" })).rejects.toMatchObject({
      code: "connection_not_found",
      status: 404,
      actionId: "github.get_current_user",
    });
  });
});

describe("OpenConnector — health & catalog", () => {
  it("health GETs /v1/health and returns the payload", async () => {
    const { open, calls } = openRecorder(() => ok({ ok: true, runtime: "oomol-connect" }));
    const health = await open.health();
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(`${BASE}/v1/health`);
    expect(health).toEqual({ ok: true, runtime: "oomol-connect" });
  });

  it("catalog.action GETs one action by encoded id, preserving the runtime metadata shape", async () => {
    // The runtime wraps follow-ups as `{ actionId }` objects and nulls an absent asyncLifecycle —
    // the OpenActionMetadata contract, distinct from the hosted ActionMetadata.
    const meta = {
      id: "github.get_current_user",
      service: "github",
      name: "x",
      description: "",
      requiredScopes: [],
      providerPermissions: [],
      inputSchema: {},
      outputSchema: {},
      followUpActions: [{ actionId: "github.list_repos" }],
      asyncLifecycle: null,
    };
    const { open, calls } = openRecorder(() => ok(meta));
    const action = await open.catalog.action("github.get_current_user");
    expect(calls[0]!.url).toBe(`${BASE}/v1/actions/github.get_current_user`);
    expect(action).toEqual(meta);
    expect(action.followUpActions[0]!.actionId).toBe("github.list_repos");
  });

  it("catalog.actions filters by ?service=; catalog.services flattens the bare list", async () => {
    const { open, calls } = openRecorder((call) =>
      call.url.includes("service=") ? ok([{ id: "github.x" }]) : ok([{ service: "github" }, { service: "gmail" }]),
    );
    const actions = await open.catalog.actions("github");
    const services = await open.catalog.services();

    expect(calls[0]!.url).toBe(`${BASE}/v1/actions?service=github`);
    expect(actions).toEqual([{ id: "github.x" }]);
    expect(calls[1]!.url).toBe(`${BASE}/v1/actions`);
    expect(services).toEqual(["github", "gmail"]);
  });

  it("catalog.providers repeats ?service= per id and passes ?q=", async () => {
    const { open, calls } = openRecorder(() => ok([]));
    await open.catalog.providers({ service: ["github", "gmail"], q: "git" });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/providers");
    expect(url.searchParams.getAll("service")).toEqual(["github", "gmail"]);
    expect(url.searchParams.get("q")).toBe("git");
  });

  it("catalog.search sends q / service / stringified limit and returns hits", async () => {
    const hit = { id: "github.x", service: "github", name: "x", description: "", inputSchema: {}, outputSchema: {} };
    const { open, calls } = openRecorder(() => ok([hit]));
    const hits = await open.catalog.search("issues", { service: "github", limit: 5 });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/actions/search");
    expect(url.searchParams.get("q")).toBe("issues");
    expect(url.searchParams.get("service")).toBe("github");
    expect(url.searchParams.get("limit")).toBe("5");
    expect(hits).toEqual([hit]);
  });
});

describe("OpenConnector — apps", () => {
  it("apps.list renames the wire `alias` to `connectionName`", async () => {
    const { open, calls } = openRecorder(() => ok([appPayload()]));
    const apps = await open.apps.list();

    expect(calls[0]!.url).toBe(`${BASE}/v1/apps`);
    expect(apps[0]!.connectionName).toBe("default");
    expect("alias" in apps[0]!).toBe(false);
    expect(apps[0]!.status).toBe("active");
  });

  it("apps.listByService scopes to one encoded service and renames alias too", async () => {
    const { open, calls } = openRecorder(() => ok([appPayload({ alias: null })]));
    const apps = await open.apps.listByService("github enterprise");

    expect(calls[0]!.url).toBe(`${BASE}/v1/apps/services/github%20enterprise`);
    expect(apps[0]!.connectionName).toBeNull();
  });

  it("apps.authenticated repeats ?service= and returns the authenticated subset", async () => {
    const { open, calls } = openRecorder(() => ok(["github"]));
    const authed = await open.apps.authenticated(["github", "hackernews"]);

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/v1/apps/authenticated");
    expect(url.searchParams.getAll("service")).toEqual(["github", "hackernews"]);
    expect(authed).toEqual(["github"]);
  });
});

describe("OpenConnector — service namespaces (path 2)", () => {
  it("constructor returns a Proxy; reserved members survive and are callable", () => {
    const { open } = openRecorder(() => ok({}));
    expect(typeof open.execute).toBe("function");
    expect(typeof open.executeRaw).toBe("function");
    expect(typeof open.health).toBe("function");
    expect(typeof open.catalog).toBe("object");
    expect(typeof open.catalog.action).toBe("function");
    expect(typeof open.apps).toBe("object");
  });

  it("namespace call forwards to execute with `${service}.${action}` and threads options", async () => {
    const { open, calls } = openRecorder(() => ok({ ok: 1 }, { executionId: "e", actionId: "gmail.search_threads" }), {
      connectionName: "work",
    });
    const data = await open.gmail.search_threads({ query: "from:boss" });
    await open.gmail.search_threads({ query: "x" }, { connectionName: "personal" });

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${BASE}/v1/actions/gmail.search_threads`);
    expect(calls[0]!.body).toEqual({ input: { query: "from:boss" } });
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("work"); // client default
    expect(calls[1]!.headers["x-oo-connector-alias"]).toBe("personal"); // per-call wins
    expect(data).toEqual({ ok: 1 });
  });

  it("top-level `then` is undefined (await on client does not hang)", () => {
    const { open } = openRecorder(() => ok({}));
    expect((open as unknown as Record<string, unknown>).then).toBeUndefined();
  });

  it("second-level service Proxy: `then`/`catch`/`finally` and symbols return undefined", () => {
    const { open } = openRecorder(() => ok({}));
    const svc = open.anyService as unknown as Record<PropertyKey, unknown>;
    expect(svc.then).toBeUndefined();
    expect(svc.catch).toBeUndefined();
    expect(svc.finally).toBeUndefined();
    expect(svc[Symbol.iterator]).toBeUndefined();
    expect(svc[Symbol.toPrimitive]).toBeUndefined();
    // any normal key resolves to a callable
    expect(typeof svc.anyAction).toBe("function");
  });

  it("`await open.<service>` resolves immediately and does NOT hang", async () => {
    const { open } = openRecorder(() => ok({}));
    const sentinel = Symbol("timeout");
    const result = await Promise.race([
      (async () => {
        // If the second-level Proxy were thenable, this await would hang forever.
        const svc = await (open.someService as unknown as Promise<unknown>);
        return svc;
      })(),
      new Promise((resolve) => setTimeout(() => resolve(sentinel), 200)),
    ]);
    expect(result).not.toBe(sentinel);
  });

  it("top-level symbol access routes through Reflect.get, not a service namespace", () => {
    const { open } = openRecorder(() => ok({}));
    expect((open as unknown as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined();
  });

  it("is an OpenConnector instance (the factory installs the class prototype)", () => {
    const { open } = openRecorder(() => ok({}));
    expect(open).toBeInstanceOf(OpenConnector);
    expect(new OpenConnector()).toBeInstanceOf(OpenConnector);
  });

  it("members cannot be clobbered: assignment throws and the API panel survives", () => {
    const { open } = openRecorder(() => ok({}));
    const mutable = open as unknown as Record<string, unknown>;
    expect(() => {
      mutable.catalog = 123;
    }).toThrow(TypeError);
    expect(() => {
      mutable.apps = 123;
    }).toThrow(TypeError);
    expect(typeof open.catalog.action).toBe("function");
    expect(typeof open.apps.list).toBe("function");
  });
});

describe("OpenConnector — runtime middleware error shapes", () => {
  it("maps the non-envelope 401 the runtime's auth middleware emits on /v1 routes", async () => {
    const { open } = openRecorder(() => runtimeFail("unauthorized", 401, "A valid local bearer token is required."));
    await expect(open.apps.list()).rejects.toMatchObject({
      code: "unauthorized",
      status: 401,
      message: "A valid local bearer token is required.",
    });
  });

  it("retries a non-envelope 500 by status and succeeds on the next attempt", async () => {
    const { open, calls, sleeps } = openRecorder((_call, attempt) =>
      attempt === 0 ? runtimeFail("internal_error", 500, "Internal server error.") : ok([appPayload()]),
    );
    const apps = await open.apps.list();

    expect(apps).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1); // one backoff between the failed and successful attempts
  });

  it("honors per-call retries: 0 disabling the retry a 500 would otherwise get", async () => {
    const { open, calls } = openRecorder(() => runtimeFail("internal_error", 500, "Internal server error."));
    await expect(open.apps.list({ retries: 0 })).rejects.toMatchObject({
      code: "internal_error",
      status: 500,
    });
    expect(calls).toHaveLength(1);
  });

  it("honors a client-level maxRetries: 0 the same way", async () => {
    const { open, calls } = openRecorder(() => runtimeFail("internal_error", 500, "Internal server error."), {
      maxRetries: 0,
    });
    await expect(open.apps.list()).rejects.toMatchObject({ code: "internal_error", status: 500 });
    expect(calls).toHaveLength(1);
  });
});
