# Examples

Runnable, type-checked examples covering the full `@oomol-lab/connector` surface. Run any with a
real API key:

```sh
OOMOL_API_KEY=api_... bun run examples/basic.ts
```

| File | Covers |
| --- | --- |
| [`basic.ts`](./basic.ts) | Quickstart: `execute` (path 1), `oomol.<service>.<action>` (path 2), `executeRaw` metadata |
| [`feedback-to-notion.ts`](./feedback-to-notion.ts) | Scenario: a Web-standard `/feedback` route → `notion.append_block` appends each note to a Notion page |
| [`catalog.ts`](./catalog.ts) | `catalog.providers` (incl. `{ service, q }` filter), `catalog.actions`, `catalog.action` (JSON Schema) |
| [`apps.ts`](./apps.ts) | `apps.list` (read-only); reading `id` / `service` / `status` / `connectionName` |
| [`project.ts`](./project.ts) | `ProjectConnector` (separate client, project API key): `connect.{oauth,apiKey,customCredential}`, `waitForConnection`, `execute`, `forUser` — connect accounts for your end-users and act on their behalf |
| [`open.ts`](./open.ts) | `OpenConnector` (separate client, open-source self-hosted runtime): `execute` + `open.<service>.<action>` namespace sugar, `catalog` (incl. `search` / `services`), `apps`, `health` — the personal surface against your own server |
| [`proxy.ts`](./proxy.ts) | `proxy` passthrough — typed GET/POST, `endpoint` / `query` / `headers` / `body` |
| [`scoping-and-options.ts`](./scoping-and-options.ts) | `new Connector({...})`, `using()`, per-call options, `AbortSignal`, timeout/retries, custom `fetch` |
| [`error-handling.ts`](./error-handling.ts) | `ConnectorError` fields, `err.code` discrimination, `isRetryable`, client codes |

## Precise per-action types (optional)

Every action is loosely callable out of the box (`Record<string, any>` in/out). To light up
precise input/output types + JSDoc, install [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types)
and add **one side-effect import per provider**:

```ts
import "@oomol-lab/connector-types/gmail";
import "@oomol-lab/connector-types/slack";
```
