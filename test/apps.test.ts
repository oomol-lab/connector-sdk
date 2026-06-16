import { describe, expect, it } from "vitest";
import { ok, recorder } from "./helpers";

describe("M3 — apps connection introspection (read-only)", () => {
  it("apps.list GETs /v1/apps and surfaces the gateway `alias` as `connectionName`", async () => {
    // Gateway shape uses `alias`; the SDK renames it to `connectionName` so users never see `alias`.
    const gatewayApps = [
      { id: "a-1", service: "gmail", status: "active", alias: "work" },
      { id: "a-2", service: "slack", status: "active", alias: null },
    ];
    const { oomol, calls } = recorder(() => ok(gatewayApps));
    const result = await oomol.apps.list();
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe("https://connector.oomol.com/v1/apps");
    expect(result).toEqual([
      { id: "a-1", service: "gmail", status: "active", connectionName: "work" },
      { id: "a-2", service: "slack", status: "active", connectionName: null },
    ]);
    expect("alias" in result[0]!).toBe(false);
  });

  it("apps calls carry organization + auth like any other request", async () => {
    const { oomol, calls } = recorder(() => ok([]), { organization: "org-1" });
    await oomol.apps.list();
    expect(calls[0]!.headers["authorization"]).toBe("Bearer test-key");
    expect(calls[0]!.headers["x-oo-organization-name"]).toBe("org-1");
  });

  it("tolerates a null data payload, yielding an empty list", async () => {
    // A null `data` must coalesce to [] rather than throwing in the `.map`.
    const { oomol } = recorder(() => ok(null));
    const result = await oomol.apps.list();
    expect(result).toEqual([]);
  });
});
