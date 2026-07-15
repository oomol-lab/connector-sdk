import { describe, expect, it } from "vitest";
import { ok, recorder } from "./helpers";

function url(u: string) {
  return new URL(u);
}

describe("M1 — team / alias mapping", () => {
  it("team → x-oo-team-name (per-call)", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    await oomol.execute("svc.act", {}, { team: "team-1" });
    expect(calls[0]!.headers["x-oo-team-name"]).toBe("team-1");
  });

  it("alias → X-Oo-Connector-Alias header (never the query string)", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    await oomol.execute("svc.act", {}, { connectionName: "work" });
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("work");
    expect(url(calls[0]!.url).searchParams.get("alias")).toBeNull();
  });
});

describe("M1 — option precedence (per-call > using() scope > client default)", () => {
  it("client default alias is used when nothing overrides", async () => {
    const { oomol, calls } = recorder(() => ok({}), { connectionName: "default-alias" });
    await oomol.execute("svc.act", {});
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("default-alias");
  });

  it("using() scope overrides client default; per-call overrides scope", async () => {
    const { oomol, calls } = recorder(() => ok({}), { team: "team-default" });
    const scoped = oomol.using({ team: "team-scope", connectionName: "scope-alias" });

    await scoped.execute("svc.act", {});
    expect(calls[0]!.headers["x-oo-team-name"]).toBe("team-scope");
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("scope-alias");

    await scoped.execute("svc.act", {}, { team: "team-call" });
    expect(calls[1]!.headers["x-oo-team-name"]).toBe("team-call");
  });

  it("using() is immutable: the original client is unaffected", async () => {
    const { oomol, calls } = recorder(() => ok({}), { team: "team-default" });
    oomol.using({ team: "team-scope" });
    await oomol.execute("svc.act", {});
    expect(calls[0]!.headers["x-oo-team-name"]).toBe("team-default");
  });

  it("a using() scope that omits team still inherits the client default", async () => {
    const { oomol, calls } = recorder(() => ok({}), { team: "team-default" });
    const scoped = oomol.using({ connectionName: "work" });
    await scoped.execute("svc.act", {});
    expect(calls[0]!.headers["x-oo-team-name"]).toBe("team-default");
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("work");
  });

  it("per-call alias overrides an inherited scope alias", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    const scoped = oomol.using({ connectionName: "scope-alias" });
    await scoped.execute("svc.act", {}, { connectionName: "call-alias" });
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("call-alias");
  });
});
