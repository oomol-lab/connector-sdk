import { describe, expect, it } from "vitest";
import { ConnectorError } from "../src/index";
import { fail, ok, recorder } from "./helpers";

describe("M2 — proxy() passthrough", () => {
  it("POSTs to /v1/proxy/{service} with the strict request body", async () => {
    const { oomol, calls } = recorder(() =>
      ok({ status: 200, headers: { "content-type": "application/json" }, data: { hi: 1 } }),
    );
    const res = await oomol.proxy("github", {
      endpoint: "/user/repos",
      method: "GET",
      query: { per_page: 10 },
    });
    expect(calls[0]!.url).toBe("https://connector.oomol.com/v1/proxy/github");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({
      endpoint: "/user/repos",
      method: "GET",
      query: { per_page: 10 },
    });
    expect(res).toEqual({
      status: 200,
      headers: { "content-type": "application/json" },
      data: { hi: 1 },
    });
  });

  it("surfaces proxy_upstream_error as a ConnectorError", async () => {
    const { oomol } = recorder(() => fail("proxy_upstream_error", 502), { maxRetries: 0 });
    const err = await oomol
      .proxy("github", { endpoint: "/x", method: "GET" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("proxy_upstream_error");
  });
});

describe("M2 — catalog introspection", () => {
  it("catalog.action GETs /v1/actions/{id}", async () => {
    const meta = {
      id: "gmail.search_threads",
      service: "gmail",
      name: "search_threads",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    };
    const { oomol, calls } = recorder(() => ok(meta));
    const result = await oomol.catalog.action("gmail.search_threads");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://connector.oomol.com/v1/actions/gmail.search_threads");
    expect(result).toEqual(meta);
  });

  it("catalog.action on an unknown action surfaces HTTP 404 (distinguishable from 400)", async () => {
    const { oomol } = recorder(() => fail("invalid_input", 404, { meta: { actionId: "x.y" } }), {
      maxRetries: 0,
    });
    const err = await oomol.catalog.action("x.y").catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.status).toBe(404); // unknown action == 404, vs bad input == 400
    expect(err.code).toBe("invalid_input");
  });

  it("catalog.actions GETs /v1/actions?service=X", async () => {
    const { oomol, calls } = recorder(() => ok([]));
    await oomol.catalog.actions("gmail");
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/v1/actions");
    expect(u.searchParams.get("service")).toBe("gmail");
  });

  it("catalog.providers GETs /v1/providers with no query when unfiltered", async () => {
    const { oomol, calls } = recorder(() => ok([]));
    await oomol.catalog.providers();
    expect(calls[0]!.url).toBe("https://connector.oomol.com/v1/providers");
  });

  it("catalog.providers forwards service[]/q as server-side query params", async () => {
    const { oomol, calls } = recorder(() => ok([]));
    await oomol.catalog.providers({ service: ["gmail", "slack"], q: "mail" });
    const u = new URL(calls[0]!.url);
    expect(u.pathname).toBe("/v1/providers");
    expect(u.searchParams.getAll("service")).toEqual(["gmail", "slack"]);
    expect(u.searchParams.get("q")).toBe("mail");
  });
});

describe("M2 — two-path equivalence", () => {
  it("oomol.execute('svc.act', input) and oomol.svc.act(input) hit the same endpoint/body", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    await oomol.execute("gmail.search_threads", { query: "x" });
    await (oomol as any).gmail.search_threads({ query: "x" });
    expect(calls[0]!.url).toBe(calls[1]!.url);
    expect(calls[0]!.body).toEqual(calls[1]!.body);
    expect(calls[0]!.method).toBe(calls[1]!.method);
  });

  it("namespace path forwards CallOptions just like execute", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    await oomol.execute("gmail.search_threads", { query: "x" }, { connectionName: "work" });
    await (oomol as any).gmail.search_threads({ query: "x" }, { connectionName: "work" });
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("work");
    expect(calls[1]!.headers["x-oo-connector-alias"]).toBe("work");
  });
});
