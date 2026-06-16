import { describe, expect, it } from "vitest";
import { ok, recorder } from "./helpers";

/**
 * End-to-end through the full stack (Connector → resolve options → build spec → send →
 * parse envelope → return data), driven by a RECORDED fixture response.
 */
describe("M1 — recorded-fixture e2e (gmail.search_threads)", () => {
  it("returns the action output and threads through the real request pipeline", async () => {
    const recorded = {
      threads: [
        { threadId: "t-1", snippet: "Re: Q3 planning" },
        { threadId: "t-2", snippet: "Lunch?" },
      ],
    };
    const { oomol, calls } = recorder(
      () => ok(recorded, { executionId: "exec-abc", actionId: "gmail.search_threads" }),
      { apiKey: "live-ish-key" },
    );

    const data = await oomol.execute("gmail.search_threads", { query: "from:boss" });

    expect(data).toEqual(recorded);
    expect(calls[0]!.headers["authorization"]).toBe("Bearer live-ish-key");
    expect(calls[0]!.url).toBe("https://connector.oomol.com/v1/actions/gmail.search_threads");
    expect(calls[0]!.body).toEqual({ input: { query: "from:boss" } });
  });
});
