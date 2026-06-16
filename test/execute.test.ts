import { describe, expect, it } from "vitest";
import { ConnectorError } from "../src/index";
import { ok, recorder } from "./helpers";

describe("M1 — execute / executeRaw", () => {
  it("POSTs to /v1/actions/{id} with `{ input }` and returns data directly", async () => {
    const { oomol, calls } = recorder(() => ok({ threads: [1, 2] }));
    const data = await oomol.execute("gmail.search_threads", { query: "from:boss" });

    expect(data).toEqual({ threads: [1, 2] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://connector.oomol.com/v1/actions/gmail.search_threads");
    expect(calls[0]!.body).toEqual({ input: { query: "from:boss" } });
  });

  it("executeRaw exposes executionId / actionId / message metadata", async () => {
    const { oomol } = recorder(() =>
      ok({ x: 1 }, { executionId: "exec-42", actionId: "gmail.search_threads" }),
    );
    const raw = await oomol.executeRaw("gmail.search_threads", { query: "q" });
    expect(raw.data).toEqual({ x: 1 });
    expect(raw.executionId).toBe("exec-42");
    expect(raw.actionId).toBe("gmail.search_threads");
    expect(raw.message).toBe("OK");
  });

  it("sends Authorization: Bearer + default headers", async () => {
    const { oomol, calls } = recorder(() => ok({}), { apiKey: "secret" });
    await oomol.execute("svc.act", {});
    const h = calls[0]!.headers;
    expect(h["authorization"]).toBe("Bearer secret");
    expect(h["content-type"]).toBe("application/json");
    expect(h["accept"]).toBe("application/json");
    expect(h["user-agent"]).toMatch(/^@oomol-lab\/connector\//);
  });

  it("encodes odd action ids in the path", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    await oomol.execute("svc.with space", {});
    expect(calls[0]!.url).toContain("/actions/svc.with%20space");
  });

  it("honors baseUrl override and strips trailing slashes", async () => {
    const { oomol, calls } = recorder(() => ok({}), {
      baseUrl: "https://connector.oomol.dev/v1/",
    });
    await oomol.execute("svc.act", {});
    expect(calls[0]!.url).toBe("https://connector.oomol.dev/v1/actions/svc.act");
  });

  it("throws if apiKey is missing", () => {
    expect(() => recorder(() => ok({}), { apiKey: "" })).toThrow(ConnectorError);
  });
});
