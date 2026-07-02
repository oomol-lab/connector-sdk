/**
 * OpenConnector — the personal client for the open-source, self-hosted Connector runtime.
 *
 * It mirrors the core `Connector` surface (execute + `open.<service>.<action>` namespace sugar,
 * catalog / apps / health) against the server YOU run. Connections and credentials are managed in
 * the runtime's web console — the SDK only consumes them. Auth is a single optional runtime token
 * (`oct_…`, minted in that console); a fresh instance answers without one.
 *
 *   # start the runtime first, then:
 *   OOMOL_CONNECT_URL=http://localhost:3000 bun run examples/open.ts
 *
 * For precise per-action input/output types + JSDoc on BOTH call paths, install
 * `@oomol-lab/connector-types` and add one side-effect import per provider (e.g.
 * `import "@oomol-lab/connector-types/gmail";`). Without it, every action stays loosely typed.
 */
import { ConnectorError, OpenConnector } from "@oomol-lab/connector";

// Every field is optional: a fresh runtime needs no auth at all.
const open = new OpenConnector({
  baseUrl: process.env.OOMOL_CONNECT_URL ?? "http://localhost:3000", // the server ORIGIN, not a /v1 url
  runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // oct_... from the runtime's web console
});

async function main() {
  // --- Probe the runtime -------------------------------------------------------------------------
  const health = await open.health();
  console.log("runtime:", health.runtime);

  // --- Browse the catalog ------------------------------------------------------------------------
  const services = await open.catalog.services();
  console.log("services with actions:", services.length);
  const hits = await open.catalog.search("top stories", { limit: 3 });
  console.log("search:", hits.map((hit) => hit.id));
  const action = await open.catalog.action("hackernews.get_top_stories");
  console.log("input schema keys:", Object.keys(action.inputSchema));

  // --- Execute actions ---------------------------------------------------------------------------
  // No-auth providers (like hackernews) work with zero setup; others use the connections you made
  // in the runtime's web console — select one by name with `connectionName` when you have several.
  const stories = await open.execute("hackernews.get_top_stories", {}); // path 1 — dynamic string
  console.log("output:", stories);
  const user = await open.github.get_current_user({}, { connectionName: "work" }); // path 2 — namespace sugar
  console.log("user:", user);
  const raw = await open.executeRaw("github.get_current_user", {}, { connectionName: "work" });
  console.log("executionId:", raw.executionId);

  // --- Inspect what's connected ------------------------------------------------------------------
  const apps = await open.apps.list();
  console.log("connected apps:", apps.map((app) => `${app.service}:${app.connectionName}`));
  const authed = await open.apps.authenticated(["github", "notion"]);
  console.log("with real credentials:", authed);
}

main().catch((err) => {
  if (err instanceof ConnectorError) {
    // Same typed error model as the hosted clients — e.g. "unauthorized" (runtime token required),
    // "connection_not_found", or "invalid_input" for an unknown action.
    console.error(`[${err.code}] ${err.message}`);
  } else {
    throw err;
  }
});
