/**
 * Catalog introspection — runtime discovery of providers, actions, and their JSON Schemas.
 * Everything here is read-only.
 *
 *   OOMOL_API_KEY=api_... bun run examples/catalog.ts
 */
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });

async function main() {
  // List every provider (614+). Each: { service, displayName, iconUrl, homepageUrl, categories, authTypes }.
  const all = await oomol.catalog.providers();
  console.log(`providers: ${all.length}`);
  console.log("first:", all[0]?.service, "-", all[0]?.displayName);

  // Narrow server-side with a free-text search (?q=) ...
  const mailish = await oomol.catalog.providers({ q: "mail" });
  console.log("q=mail:", mailish.map((p) => p.service));

  // ... or restrict to specific service ids (?service=a&service=b).
  const some = await oomol.catalog.providers({ service: ["gmail", "slack"] });
  console.log("service[]:", some.map((p) => `${p.service} (${p.authTypes.join(", ")})`));

  // All actions of one service.
  const actions = await oomol.catalog.actions("gmail");
  console.log("gmail actions:", actions.map((a) => a.id));

  // Full metadata for a single action, including runtime JSON Schema (2020-12) for input/output.
  const meta = await oomol.catalog.action("gmail.search_threads");
  console.log("name:", meta.name, "| scopes:", meta.requiredScopes);
  console.log("inputSchema:", JSON.stringify(meta.inputSchema));
  console.log("outputSchema:", JSON.stringify(meta.outputSchema));
}

void main();
