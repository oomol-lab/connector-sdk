# @oomol-lab/connector

**Call any connector action in one typed line.** Thin, zero-dependency HTTP client for the OOMOL Connector gateway — run actions, proxy upstream APIs, and introspect the catalog. Auth, OAuth, and credentials live on the gateway; the SDK is just the typed call.

[![npm](https://img.shields.io/npm/v/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**Zero runtime dependencies.** Works fully with loose typing — add [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) to light up precise per-action types + JSDoc. No codegen, no CLI.

```ts
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! }); // → Authorization: Bearer <apiKey>

// Path 1 — dynamic string, always callable
const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });

// Path 2 — namespace sugar, same call underneath
const r = await oomol.gmail.search_threads({ query: "from:boss" });
```

## Get an API key

You need an OOMOL Connector API key (shaped like `api_…`). Set it as `OOMOL_API_KEY` and you're ready — the SDK never validates the key locally; the gateway authorizes each request.

<https://console.oomol.com/api-key>

## Install

```sh
npm install @oomol-lab/connector   # or: bun add / pnpm add / yarn add
```

Requires Node ≥ 18 (built-in `fetch` / `AbortController`). The runnable examples use Bun; the library itself is runtime-agnostic.

## Concepts

No architecture to learn — just five words, because all the heavy lifting happens on the gateway:

- **Gateway** — the hosted OOMOL Connector service this client talks to. It holds credentials, performs the actual provider calls, and returns a uniform envelope. The SDK runs **no** integration logic locally; it only builds the request and parses the reply.
- **Provider / service** — a third-party API (`gmail`, `slack`, `github`, `notion`, …). It's the `<service>` prefix of an action id.
- **Action** — one operation on a provider, identified as `"<service>.<action>"` (e.g. `gmail.search_threads`). You *call* actions; you don't define them — they live on the gateway.
- **Connection** — a stored, already-authorized credential for a provider. You never touch tokens; you just name which connection to use via `connectionName`. **OAuth and credential lifecycle are the gateway's job, not the SDK's.**
- **Organization** — optional tenant scoping.

## What you can build

| Want to… | Use | Notes |
| --- | --- | --- |
| Run a modeled action | `execute` / `executeRaw` | The typed one-liner. `executeRaw` also returns `{ executionId, actionId, message }`. |
| Hit an endpoint not yet modeled as an action | `proxy` | Passthrough to the upstream API, with the connection's credentials injected by the gateway. |
| Feed actions to an LLM / build dynamic forms | `catalog` | Runtime JSON Schema (2020-12) for any action or provider — `catalog.action` / `catalog.actions` / `catalog.providers`. |
| Discover what's connected | `apps.list` | Read-only list of the connections you've already linked. |

Provider and action coverage comes from the gateway, not this package. Discover it at runtime with `oomol.catalog.providers()`, and see [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) for the providers with precise compile-time types.

## Precise types (optional)

The dynamic string path compiles for **any** `actionId`. Registered actions get literal completion + precise input/output; unregistered ones degrade to `Record<string, any>` instead of erroring — the SDK never blocks you when the types package lags the backend.

Install [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) and add **one side-effect import per provider** you use:

```ts
import "@oomol-lab/connector-types/gmail";   // precise types + JSDoc for gmail.*
import "@oomol-lab/connector-types/slack";   // …and slack.*
```

The core runtime never depends on the types package, so every action stays at least loosely callable.

> [!NOTE]
> Requires `moduleResolution` set to `bundler`, `node16`, or `nodenext` so the subpath imports resolve. See [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) for setup details.

## Configuration

```ts
new Connector({
  apiKey: process.env.OOMOL_API_KEY!,        // required
  baseUrl: "https://connector.oomol.com/v1", // default
  organization: "org-name",                  // → x-oo-organization-name
  connectionName: "work",                    // default connection (prefer per-call / using())
  timeoutMs: 30_000,                         // default
  maxRetries: 2,                             // default; retries 429 / 5xx / network with backoff
  fetch: customFetch,                        // inject for tests / custom agents
});
```

- **`organization`** — which tenant the call runs under.
- **`connectionName`** — *which* stored credential to use when you have more than one connection for a provider.

Per-call options (`organization`, `connectionName`, `signal`, `timeoutMs`, `retries`) override a `using()` scope, which overrides client defaults:

```ts
const work = oomol.using({ connectionName: "work" }); // immutable scoped sub-client
await work.gmail.search_threads({ query }, { signal: controller.signal, timeoutMs: 10_000 });
```

## Error handling

```ts
import { ConnectorError, isRetryable } from "@oomol-lab/connector";

try {
  await oomol.gmail.search_threads({ query });
} catch (err) {
  if (err instanceof ConnectorError) {
    err.code;      // discriminable union, e.g. "rate_limited", "credential_expired"
    err.status;    // HTTP status (0 for client / network errors)
    err.requestId; // also: err.actionId, err.executionId, err.data
    if (isRetryable(err)) { /* retry */ }
  }
}
```

## Recipes

### Feedback to Notion in one call

Pushing user feedback into Notion normally means a Notion OAuth integration, their SDK, and hand-built block-payload JSON. Collapse all of that into one call — feedback arrives, you call `append_block`, it lands as a new paragraph at the bottom of your page.

```ts
import { Connector } from "@oomol-lab/connector";
import "@oomol-lab/connector-types/notion"; // optional — precise types + JSDoc on notion.*

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });
const FEEDBACK_PAGE_ID = process.env.NOTION_FEEDBACK_PAGE_ID!;

Bun.serve({ routes: { "/feedback": async (req) => {
  const { email, message } = await req.json();
  await oomol.notion.append_block({ pageId: FEEDBACK_PAGE_ID, text: `${email ?? "anonymous"} — ${message}` });
  return Response.json({ ok: true });
} } });
```

The string path is identical — `oomol.execute("notion.append_block", { pageId, text })`. Full runnable version — [`examples/feedback-to-notion.ts`](./examples/feedback-to-notion.ts).

### Call an endpoint that has no action yet

When the gateway hasn't modeled an endpoint as an action, reach it directly with `proxy` — same auth, same connection, raw request/response.

```ts
const { status, data } = await oomol.proxy("github", {
  endpoint: "/repos/oomol-lab/connector-sdk/issues",
  method: "GET",
  query: { state: "open" },
});
```

## Why this SDK?

- **Zero runtime dependencies** — `sideEffects: false`, ships only `dist`. It's an in-process HTTP client, nothing more.
- **No codegen, no CLI** — nothing to generate or run; install and call.
- **Loose by default, precise on demand** — every action is callable immediately; opt into per-action types one provider import at a time, and missing types never break your build.
- **One uniform surface** — every provider call, every error, and every retry follows the same shape.

## Reference

- **`oomol.proxy(service, { endpoint, method, query, headers, body })`** — passthrough to an upstream provider API (use it when no action models the endpoint yet).
- **`oomol.catalog.action / .actions / .providers`** — runtime JSON Schema for dynamic UIs, validation, or LLM tools.
- **`oomol.apps.list()`** — read-only introspection of your connected apps.
- **`oomol.executeRaw(...)`** — like `execute`, but returns `{ data, executionId, actionId, message }`.

See [`examples/`](./examples) for runnable, type-checked usage of every method.

## License

[MIT](./LICENSE)
