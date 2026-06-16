# @oomol-lab/connector

Core runtime client for the [OOMOL Connector](https://connector.oomol.com) gateway — a thin,
zero-dependency HTTP client for executing connector actions, proxying upstream APIs, and
introspecting the catalog.

It runs **fully without any generated types** (loose typing). Install the optional
[`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) package and add
**one side-effect import per provider** to light up precise per-action input/output types +
JSDoc — no codegen, no CLI, no committed files.

```ts
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });

// Path 1 — dynamic string (always available)
const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });

// Path 2 — namespace sugar (same call underneath)
const r = await oomol.gmail.search_threads({ query: "from:boss" });
```

## Install

```sh
npm install @oomol-lab/connector
# or: bun add @oomol-lab/connector / pnpm add / yarn add
```

Requires Node ≥ 18 (uses the built-in `fetch` / `AbortController`).

## Authentication

The public gateway accepts a bearer token. The SDK sends `Authorization: Bearer <apiKey>`; the
gateway resolves the user/organization from the key.

```ts
const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });
```

## Two equivalent call paths

Both paths run the same `execute` underneath and behave identically.

```ts
// Path 1: execute(actionId, input, options?) — the canonical entry point.
const out = await oomol.execute("gmail.search_threads", { query: "x" });

// Path 2: <service>.<action>(input, options?) — runtime Proxy sugar.
const out2 = await oomol.gmail.search_threads({ query: "x" });
```

**Typing guarantee.** The dynamic string path compiles for **any** `actionId`. Registered
actions additionally get literal completion + precise I/O; unregistered ones (including when the
types package lags the backend, or only some providers are imported) degrade to
`Record<string, any>` instead of erroring. See [Lighting up types](#lighting-up-precise-types-optional).

## Configuration

```ts
new Connector({
  apiKey: "…",                  // required
  baseUrl: "https://connector.oomol.com/v1", // default (production); manual override only
  organization: "org-name",     // default org name → x-oo-organization-name
  accountAlias: "work",         // default account alias (weak — prefer per-call / using())
  timeoutMs: 30_000,            // default 30s
  maxRetries: 2,                // default 2 (429 / 5xx / network → exponential backoff + jitter)
  fetch: customFetch,           // inject for tests / custom agents
});
```

## Per-call options

```ts
await oomol.execute("gmail.search_threads", { query }, {
  organization: "org-name",     // override default org name
  accountAlias: "work",         // → X-Oo-Connector-Alias
  signal: controller.signal,    // AbortSignal
  timeoutMs: 10_000,
  retries: 0,                   // override retry count for this call
});
```

**Priority:** per-call options > `using()` scope > client defaults.

`accountAlias` selects which connection to use; a higher-priority layer's `accountAlias` overrides
the lower layers'.

> `accountAlias` resolves in scope `(user, service)`, so `organization` is the natural client-level
> default, while `accountAlias` is best set **per call** or via a `using()` scope.

## Scoped sub-clients — `using()`

`using()` returns an immutable sub-client that reuses the underlying connection and merges
defaults. The original client is unaffected.

```ts
const work = oomol.using({ accountAlias: "work", organization: "org-uuid" });
await work.gmail.search_threads({ query });
```

## Raw results & metadata

`execute` / namespace calls return the action output directly. Use `executeRaw` for execution
metadata:

```ts
const raw = await oomol.executeRaw("gmail.search_threads", { query });
// raw: { data, executionId, actionId, message }
```

## Proxy passthrough

```ts
const res = await oomol.proxy("github", {
  endpoint: "/user/repos",      // field is `endpoint`, NOT `path`
  method: "GET",
  query: { per_page: 10 },
});
// res: { status, headers, data }
```

`endpoint` accepts either a **path** (resolved against the provider's base URL) or a **full URL** —
useful for providers with regional hosts:

```ts
await oomol.proxy("posthog", {
  endpoint: "https://eu.posthog.com/api/users/@me/", // absolute URL → EU region
  method: "GET",
});
```

The proxy body is strict on the backend — unknown keys are rejected as `invalid_input`.

## Catalog introspection

Runtime discovery (returns JSON Schema for dynamic UIs / validation / LLM tool definitions):

```ts
const meta = await oomol.catalog.action("gmail.search_threads");
// meta.inputSchema / meta.outputSchema are runtime JSON Schema objects
const actions = await oomol.catalog.actions("gmail");
const providers = await oomol.catalog.providers();                 // all
const mailish = await oomol.catalog.providers({ q: "mail" });      // server-side search
const some = await oomol.catalog.providers({ service: ["gmail", "slack"] });
```

> On these **catalog GET** endpoints, an unknown action returns **HTTP 404**
> (`errorCode: "invalid_input"`) and a bad input returns **HTTP 400**, so you can distinguish them
> via `err.status`. This split is catalog-only: on the **`execute` path** the gateway returns
> **HTTP 400** (`errorCode: "invalid_input"`) for *both* an unknown action and a bad input, so
> there `err.status` cannot separate them — inspect `err.message` instead.

## Connected apps — `apps.*`

Read-only introspection of the connections the gateway holds for you. The SDK never
creates or removes connections — connection management lives in the Connector dashboard.

```ts
const apps = await oomol.apps.list();
// each app: { id, service, status, accountAlias, … } — pass `app.accountAlias` as the per-call `accountAlias`
```

## Error handling

All failures throw a typed `ConnectorError`:

```ts
import { ConnectorError, isRetryable } from "@oomol-lab/connector";

try {
  await oomol.gmail.search_threads({ query });
} catch (err) {
  if (err instanceof ConnectorError) {
    err.code;        // discriminable union (e.g. "rate_limited", "credential_expired", …)
    err.status;      // HTTP status (0 for client/network errors)
    err.actionId;    // when applicable
    err.executionId; // when applicable
    err.requestId;
    err.data;        // upstream body on provider_error
    if (isRetryable(err)) { /* … */ }
  }
}
```

`err.code` is an open union: known backend codes get literal completion, and unknown
forward-compat codes are still surfaced as-is. Client-only codes: `client_invalid_request`,
`client_timeout`, `client_network_error`. Caller cancellation rejects with the standard
`AbortError`.

## Lighting up precise types (optional)

Install [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) and add
**one side-effect import per provider you use**:

```ts
import "@oomol-lab/connector-types/gmail";   // lights up gmail
import "@oomol-lab/connector-types/slack";   // lights up slack
```

Now `oomol.execute("gmail.search_threads", …)` and `oomol.gmail.search_threads(…)` have precise
input/output types + JSDoc. Importing only the providers you use keeps type-checking fast.

> **Requirements & gotchas (verified across tsc versions):**
> - **`moduleResolution` must be `bundler`, `node16`, or `nodenext`** so the subpath `exports`
>   resolve. Classic `node` (node10) ignores `exports` and the augmentation silently does not
>   load (you simply fall back to loose typing — no runtime error). The types package ships a
>   `typesVersions` fallback for node10.
> - The side-effect import is safe at runtime: the types package ships an empty JS stub per
>   provider, so the `import` does not crash under Node's ESM resolver.
>
> The core runtime (`@oomol-lab/connector`) never depends on the types package — every action is
> always at least loosely callable, whether or not you install or import it.

## Development

```sh
bun install
bun run check        # lint + typecheck + build + unit tests + type-level acceptance
bun run test         # vitest unit tests
bun run test:types   # tsd three-state assertions + moduleResolution matrix
bun run build        # ESM + CJS + d.ts (tsdown)
```

## License

MIT
