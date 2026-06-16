/**
 * Quickstart — the two call paths + execution metadata.
 *
 * Run with a real API key:
 *   OOMOL_API_KEY=api_... bun run examples/basic.ts
 *
 * For precise per-action input/output types + JSDoc, install `@oomol-lab/connector-types`
 * and add one side-effect import per provider you use (no codegen, no committed files):
 *
 *   import "@oomol-lab/connector-types/gmail";   // lights up gmail.* on both call paths
 *
 * Without it, every action stays loosely callable (`Record<string, any>` in/out).
 */
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });

async function main() {
  // Path 1 — dynamic string entry point. Always callable; precise for registered actions.
  const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });
  console.log("path 1:", threads);

  // Path 2 — namespace sugar. Same `execute` underneath, identical behavior.
  const result = await oomol.gmail.search_threads({ query: "is:unread" });
  console.log("path 2:", result.threads);

  // executeRaw exposes execution metadata alongside the output.
  const raw = await oomol.executeRaw("gmail.search_threads", { query: "from:ceo" });
  console.log("data:", raw.data);
  console.log("executionId:", raw.executionId, "actionId:", raw.actionId, "message:", raw.message);
}

void main();
