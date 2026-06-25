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
| Let *your* users connect *their* accounts | `ProjectConnector` | A separate project-scoped client to connect accounts on behalf of your end-users and run actions for them. See [Connect accounts for your users](#connect-accounts-for-your-users). |

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

## Connect accounts for your users

`Connector` runs actions on **your** connections. **`ProjectConnector`** is the other half of the product, for building a SaaS platform on OOMOL: each of **your** end-users links **their own** Gmail / Slack / GitHub / … account through your app, and you run actions on their behalf — the [composio](https://composio.dev) / [pipedream](https://pipedream.com/docs/connect) "managed auth" model.

It's a **separate client**, constructed with a **project API key** (`oo_proj_…`). It exposes only project-scoped operations — completely distinct from the personal `Connector` (different key, methods, and types), so there's nothing to mix up:

```ts
import { ProjectConnector } from "@oomol-lab/connector";

const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! }); // oo_proj_...
```

Identify each end-user with an opaque `externalUserId` you choose.

### OAuth — create a link, then await completion

```ts
// Returns a pending connection request — send your user to `.authorizationUrl` to authorize.
const request = await project.connect.oauth("user_42", { service: "gmail", connectionName: "work" });
redirectUserTo(request.authorizationUrl);

// Poll until the user finishes (or it fails / expires); returns the final connection request.
const connected = await project.waitForConnection(request);
```

### API key / custom credential — synchronous, no waiting

```ts
const account = await project.connect.apiKey("user_42", { service: "openai", apiKey: "sk-..." });
await project.connect.customCredential("user_42", { service: "jira", values: { email, token } });
```

### Execute on the user's behalf

```ts
// The provider service is derived from the actionId prefix; the user's latest active account is used
// unless you pass `connectionName` (or `connectedAccountId`).
const out = await project.execute(
  "user_42",
  "gmail.search_threads",
  { query: "is:unread" },
  { connectionName: "work" },
);
```

### Scope to one user

```ts
const user = project.forUser("user_42"); // bind the end-user once; drop the repeated id
await user.connect.oauth({ service: "gmail" });
await user.execute("gmail.search_threads", { query: "from:ceo" });
```

`project.execute` reuses the same [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) registry as the core path — registered actions get precise input/output, the rest stay loosely callable.

> [!NOTE]
> `connectionName` is the single name for a connection: you assign it on `connect.*`, then pass it back as `execute`'s `connectionName` to target that account (the gateway's wire field is `alias`). The end-user is always `externalUserId`. Connecting by API key or custom credential is synchronous — only OAuth needs `waitForConnection`.

**Coming from composio / pipedream?**

| composio / pipedream | `@oomol-lab/connector` |
| --- | --- |
| `userId` / `external_user_id` | `externalUserId` |
| `connectedAccounts.initiate` / `createConnectToken` (OAuth) | `project.connect.oauth` |
| `connectedAccounts.initiate` + `AuthScheme.APIKey` | `project.connect.apiKey` |
| `waitForConnection()` | `project.waitForConnection()` |
| `tools.execute(slug, { userId, arguments })` | `project.execute(externalUserId, actionId, input)` |
| `composio.getEntity(userId)` | `project.forUser(externalUserId)` |

Full runnable lifecycle — [`examples/project.ts`](./examples/project.ts).

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
- **`ProjectConnector`** — a separate client (project API key) to build a SaaS platform: `connect.oauth` / `connect.apiKey` / `connect.customCredential`, `waitForConnection`, `execute` / `executeRaw` on a user's behalf, and `forUser` to scope to one user. See [Connect accounts for your users](#connect-accounts-for-your-users).

See [`examples/`](./examples) for runnable, type-checked usage of every method.

## License

[MIT](./LICENSE)
