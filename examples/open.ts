/**
 * OpenConnector — the personal client for the open-source, self-hosted Connector runtime.
 *
 * It mirrors the core `Connector` surface (execute + `open.<service>.<action>` namespace sugar,
 * proxy passthrough, catalog / apps / health) against the server YOU run. Auth is a single optional
 * runtime token (`oct_…`, minted in the runtime's web console); a fresh instance answers without one.
 *
 * Creating connections is possible too (`connect.*`), but it is ADMIN-scoped on the runtime: it
 * takes the separate `adminToken`, never the runtime token. The rest of connection administration
 * (deleting connections, OAuth client setup, minting tokens) stays in the web console.
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
  adminToken: process.env.OOMOL_CONNECT_ADMIN_TOKEN, // only `connect.*` uses this one
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

  // --- Proxy an endpoint that has no action yet ---------------------------------------------------
  // Path 3 — reach a provider endpoint directly, credentials injected server-side. The runtime
  // requires a RELATIVE `endpoint` (starting with `/`); pick a connection with `connectionName`.
  const repos = await open.proxy("github", { endpoint: "/user/repos", method: "GET", query: { per_page: 5 } });
  console.log("proxy status:", repos.status, "repos:", Array.isArray(repos.data) ? repos.data.length : repos.data);

  // --- Create a connection (admin-scoped) ---------------------------------------------------------
  // OAuth is asynchronous: send the user to the URL, then poll. Every terminal status resolves —
  // only your own `maxWaitMs` throws (`client_wait_timeout`).
  const started = await open.connect.oauth("gmail", { returnUri: "http://localhost:5173/oauth/done" });
  console.log("authorize at:", started.authorizationUrl);
  const settled = await open.connect.waitForConnection(started, { pollIntervalMs: 2_000 });
  console.log("attempt settled:", settled.status, settled.appId);

  // The credential modes are synchronous — the connection comes back ready to use.
  const openai = await open.connect.apiKey("openai", { apiKey: process.env.OPENAI_API_KEY! });
  console.log("connected:", openai.id, openai.connectionName);

  // --- Inspect what's connected ------------------------------------------------------------------
  const apps = await open.apps.list();
  console.log("connected apps:", apps.map((app) => `${app.service}:${app.connectionName}`));
  const authed = await open.apps.authenticated(["github", "notion"]);
  console.log("with real credentials:", authed);
}

main().catch((err) => {
  if (err instanceof ConnectorError) {
    // Same typed error model as the hosted clients — e.g. "unauthorized" (runtime token required,
    // or an ADMIN token on the connect routes), "connection_not_found", or "invalid_input" for an
    // unknown action.
    console.error(`[${err.code}] ${err.message}`);
  } else {
    throw err;
  }
});
