/**
 * Proxy passthrough — call a provider's upstream API directly through the gateway, using the
 * connection's stored credentials. Useful for endpoints not yet modeled as actions.
 *
 *   OOMOL_API_KEY=api_... bun run examples/proxy.ts
 */
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });

async function main() {
  // GET with a typed response. NOTE the field is `endpoint`, NOT `path`.
  const repos = await oomol.proxy<Array<{ name: string }>>("github", {
    endpoint: "/user/repos",
    method: "GET",
    query: { per_page: 5, sort: "updated" },
  });
  console.log("status:", repos.status);
  console.log("repos:", repos.data.map((r) => r.name));

  // POST with a body + upstream headers (these headers go to the provider, not the gateway).
  const created = await oomol.proxy<{ id: number; html_url: string }>("github", {
    endpoint: "/repos/acme/widgets/issues",
    method: "POST",
    headers: { "X-GitHub-Api-Version": "2022-11-28" },
    body: { title: "Tracking issue", labels: ["chore"] },
  });
  console.log("created issue:", created.data.html_url);

  // `endpoint` also accepts a FULL URL — handy for providers with regional hosts. PostHog, for
  // example, is split across us.posthog.com and eu.posthog.com; target a region by passing the
  // absolute URL instead of a path (which would resolve against the provider's default base URL).
  const me = await oomol.proxy<{ email: string }>("posthog", {
    endpoint: "https://eu.posthog.com/api/users/@me/",
    method: "GET",
  });
  console.log("posthog user (EU host):", me.data.email);

  // The proxy body is strict on the backend — unknown top-level keys are rejected as invalid_input.
}

void main();
