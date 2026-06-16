/**
 * Scoped sub-clients, per-call options, cancellation/timeout, and a custom fetch.
 *
 *   OOMOL_API_KEY=api_... bun run examples/scoping-and-options.ts
 */
import { Connector } from "@oomol-lab/connector";

// Full construction surface (every field optional except apiKey).
const oomol = new Connector({
  apiKey: process.env.OOMOL_API_KEY!,
  baseUrl: "https://connector.oomol.com/v1", // default (production); override only if needed
  organization: "acme",                      // default org name
  connectionName: "work",                    // default connection name (prefer per-call / using())
  timeoutMs: 30_000,                         // default 30s
  maxRetries: 2,                             // default 2 (429 / 5xx / network → backoff + jitter)
  fetch: globalThis.fetch,                   // inject a custom fetch (proxies, tests, tracing)
});

async function main() {
  // `using()` returns an immutable sub-client with merged defaults; the original is unaffected.
  const work = oomol.using({ connectionName: "work", organization: "acme" });
  await work.gmail.search_threads({ query: "label:urgent" });

  // Per-call options override scope + client defaults. Priority: per-call > using() > client.
  await oomol.execute(
    "gmail.search_threads",
    { query: "from:ceo" },
    {
      organization: "acme",  // override default org for this call
      connectionName: "alt",   // pick a different connection for this call
      timeoutMs: 10_000,     // tighter timeout for this call
      retries: 0,            // disable retries for this call
    },
  );

  // Cancellation — forward an AbortSignal; the call rejects with the standard AbortError.
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  try {
    await oomol.execute("gmail.search_threads", { query: "huge" }, { signal: controller.signal });
  } catch (err) {
    console.log("aborted:", (err as Error).name); // "AbortError"
  }
}

void main();
