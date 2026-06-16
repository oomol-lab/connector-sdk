# @oomol-lab/connector

Thin, zero-dependency HTTP client for the OOMOL Connector gateway — call any connector action, proxy upstream APIs, and introspect the catalog.

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

## Install

```sh
npm install @oomol-lab/connector   # or: bun add / pnpm add / yarn add
```

Requires Node ≥ 18 (built-in `fetch` / `AbortController`).

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

`err.code` is an open union — unknown forward-compat codes pass through. Caller cancellation rejects with the standard `AbortError`.

## Feedback to Notion in one call

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

## More

- **`oomol.proxy(service, { endpoint, method, query })`** — passthrough to an upstream provider API.
- **`oomol.catalog.action / .actions / .providers`** — runtime JSON Schema for dynamic UIs, validation, or LLM tools.
- **`oomol.apps.list()`** — read-only introspection of your connected apps.
- **`oomol.executeRaw(...)`** — like `execute`, but returns `{ data, executionId, actionId, message }`.

See [`examples/`](./examples) for runnable, type-checked usage of every method.

## License

[MIT](./LICENSE)
