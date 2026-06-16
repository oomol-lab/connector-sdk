import { describe, expect, it } from "vitest";
import { ok, recorder } from "./helpers";

function url(u: string) {
  return new URL(u);
}

describe("M1 — organization / alias mapping", () => {
  it("organization → x-oo-organization-name (per-call)", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    await oomol.execute("svc.act", {}, { organization: "org-1" });
    expect(calls[0]!.headers["x-oo-organization-name"]).toBe("org-1");
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
    const { oomol, calls } = recorder(() => ok({}), { organization: "org-default" });
    const scoped = oomol.using({ organization: "org-scope", connectionName: "scope-alias" });

    await scoped.execute("svc.act", {});
    expect(calls[0]!.headers["x-oo-organization-name"]).toBe("org-scope");
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("scope-alias");

    await scoped.execute("svc.act", {}, { organization: "org-call" });
    expect(calls[1]!.headers["x-oo-organization-name"]).toBe("org-call");
  });

  it("using() is immutable: the original client is unaffected", async () => {
    const { oomol, calls } = recorder(() => ok({}), { organization: "org-default" });
    oomol.using({ organization: "org-scope" });
    await oomol.execute("svc.act", {});
    expect(calls[0]!.headers["x-oo-organization-name"]).toBe("org-default");
  });

  it("per-call alias overrides an inherited scope alias", async () => {
    const { oomol, calls } = recorder(() => ok({}));
    const scoped = oomol.using({ connectionName: "scope-alias" });
    await scoped.execute("svc.act", {}, { connectionName: "call-alias" });
    expect(calls[0]!.headers["x-oo-connector-alias"]).toBe("call-alias");
  });
});
