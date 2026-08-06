<div align="center">

# @oomol-lab/connector

[English](../../README.md) · [简体中文](./README.zh-CN.md) · **繁體中文** · [日本語](./README.ja.md) · [Русский](./README.ru.md) · [Français](./README.fr.md)

[![npm](https://img.shields.io/npm/v/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![CI](https://img.shields.io/github/actions/workflow/status/oomol-lab/connector-sdk/ci.yml?branch=main&label=CI)](https://github.com/oomol-lab/connector-sdk/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@oomol-lab/connector)](https://bundlephobia.com/package/@oomol-lab/connector)
[![types](https://img.shields.io/npm/types/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

</div>

**一行帶型別的程式碼即可呼叫任何 connector action。** 這是一個輕量、零相依的 HTTP 用戶端，對接 OOMOL Connector gateway——執行 action、代理上游 API，並檢視 catalog。驗證、OAuth 與憑證都存放在 gateway 上；SDK 只負責帶型別的呼叫。

**零執行期相依。** 使用寬鬆型別即可完整運作——加入 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) 就能點亮每個 action 的精確型別與 JSDoc。無需 codegen，無需 CLI。

```ts
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! }); // → Authorization: Bearer <apiKey>

// Path 1 — dynamic string, always callable
const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });

// Path 2 — namespace sugar, same call underneath
const r = await oomol.gmail.search_threads({ query: "from:boss" });
```

> [!TIP]
> **在為*別人*打造,或想自己跑伺服器?** 本頁講的是預設的 `Connector`——在**你自己的** connection 上執行 action。同一個套件裡還有另外兩個同源用戶端:
> - **[為你的使用者連接帳號](#為你的使用者連接帳號)** — `ProjectConnector`:你的終端使用者連結*他們自己的* Gmail / Slack / GitHub / …… 帳號,由你代表他們執行 action(也就是 composio / pipedream 的託管驗證模式)。
> - **[自架執行環境](#自架執行環境)** — `OpenConnector`:同樣的型別化呼叫,指向你自己架設的開源 Connector 伺服器。

## 取得 API 金鑰

你需要一組 OOMOL Connector API 金鑰（格式類似 `api_…`）。把它設為 `OOMOL_API_KEY` 就準備就緒了——SDK 從不在本機驗證金鑰；每個請求都由 gateway 授權。

<https://console.oomol.com/api-key>

## 安裝

```sh
npm install @oomol-lab/connector   # or: bun add / pnpm add / yarn add
```

需要 Node ≥ 18（內建 `fetch` / `AbortController`）。可執行的範例使用 Bun；函式庫本身則與執行環境無關。

## 概念

沒有架構要學——只需五個名詞，因為所有繁重的工作都發生在 gateway 上：

- **Gateway** — 這個用戶端所對接、由 OOMOL 託管的 Connector 服務。它保管憑證、實際執行對 provider 的呼叫，並回傳統一格式的封裝結果。SDK 在本機**不**執行任何整合邏輯；它只負責組出請求、解析回應。
- **Provider / service** — 一個第三方 API（`gmail`、`slack`、`github`、`notion`……）。它就是 action id 的 `<service>` 前綴。
- **Action** — provider 上的一個操作，以 `"<service>.<action>"` 標識（例如 `gmail.search_threads`）。你只*呼叫* action，而不定義它們——它們都存在於 gateway 上。
- **Connection** — 針對某個 provider、已授權並儲存起來的憑證。你完全不需碰 token；只要透過 `connectionName` 指名要使用哪個 connection 即可。**OAuth 與憑證的生命週期是 gateway 的工作，而非 SDK 的。**
- **Team** — 選用的租戶範圍限定。

## 你可以打造什麼

| 想要… | 使用 | 說明 |
| --- | --- | --- |
| 執行一個已建模的 action | `execute` / `executeRaw` | 帶型別的一行呼叫。`executeRaw` 還會回傳 `{ executionId, actionId, message }`。 |
| 存取尚未被建模成 action 的端點 | `proxy` | 直通上游 API，並由 gateway 注入該 connection 的憑證。 |
| 把 action 餵給 LLM／建立動態表單 | `catalog` | 任何 action 或 provider 的執行期 JSON Schema（2020-12）——`catalog.action` / `catalog.actions` / `catalog.providers`。 |
| 查看已連接了哪些帳號 | `apps.list` | 唯讀列出你已經連結的 connection。 |
| 讓*你的*使用者連接*他們自己的*帳號 | `ProjectConnector` | 一個獨立的、以 project 為範圍的用戶端，代表你的終端使用者連接帳號並替他們執行 action。參見[為你的使用者連接帳號](#為你的使用者連接帳號)。 |
| 自行執行開源伺服器 | `OpenConnector` | 針對你自架的執行環境，提供兩種呼叫路徑（`execute` 與 `open.<service>.<action>`）以及 `catalog` / `apps` / `health`。參見[自架執行環境](#自架執行環境)。 |

Provider 與 action 的涵蓋範圍來自 gateway，而非這個套件。用 `oomol.catalog.providers()` 在執行期探索它們，並參見 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) 了解哪些 provider 具備精確的編譯期型別。

## 精確型別（選用）

動態字串路徑對**任何** `actionId` 都能通過編譯。已註冊的 action 會得到字面量自動補全與精確的輸入／輸出；未註冊的則退化為 `Record<string, any>`，而不會報錯——當型別套件落後於後端時，SDK 從不擋住你。

安裝 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types)，並為你用到的**每個 provider 各加入一行 side-effect import**：

```ts
import "@oomol-lab/connector-types/gmail";   // precise types + JSDoc for gmail.*
import "@oomol-lab/connector-types/slack";   // …and slack.*
```

核心執行期從不相依於型別套件，因此每個 action 至少都保持寬鬆可呼叫。

> [!NOTE]
> 需要將 `moduleResolution` 設為 `bundler`、`node16` 或 `nodenext`，子路徑 import 才能解析。設定細節請參見 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types)。

## 設定

```ts
new Connector({
  apiKey: process.env.OOMOL_API_KEY!,        // required
  baseUrl: "https://connector.oomol.com/v1", // default
  team: "team-name",                         // → x-oo-team-name
  connectionName: "work",                    // default connection (prefer per-call / using())
  timeoutMs: 30_000,                         // default
  maxRetries: 2,                             // default; retries 429 / 5xx / network with backoff
  fetch: customFetch,                        // inject for tests / custom agents
});
```

- **`team`** — 呼叫在哪個租戶下執行。
- **`connectionName`** — 當你對某個 provider 有多個 connection 時，指定要使用*哪一個*已儲存的憑證。

逐次呼叫的選項（`team`、`connectionName`、`signal`、`timeoutMs`、`retries`）會覆蓋 `using()` 範圍，而後者又會覆蓋用戶端的預設值：

```ts
const work = oomol.using({ connectionName: "work" }); // immutable scoped sub-client
await work.gmail.search_threads({ query }, { signal: controller.signal, timeoutMs: 10_000 });
```

## 錯誤處理

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

## 實用範例

### 一次呼叫把回饋送進 Notion

把使用者回饋推送到 Notion，通常意味著要做 Notion OAuth 整合、用他們的 SDK，還要手工拼出 block payload 的 JSON。把這一切濃縮成一次呼叫——回饋一進來，你呼叫 `append_block`，它就會以新段落的形式落在你頁面的最底部。

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

字串路徑完全相同——`oomol.execute("notion.append_block", { pageId, text })`。完整可執行版本——[`examples/feedback-to-notion.ts`](../../examples/feedback-to-notion.ts)。

### 呼叫尚無對應 action 的端點

當 gateway 尚未把某個端點建模成 action 時，用 `proxy` 直接存取它——相同的驗證、相同的 connection、原始的請求／回應。

```ts
const { status, data } = await oomol.proxy("github", {
  endpoint: "/repos/oomol-lab/connector-sdk/issues",
  method: "GET",
  query: { state: "open" },
});
```

## 為你的使用者連接帳號

`Connector` 在**你自己的** connection 上執行 action。**`ProjectConnector`** 則是這個產品的另一半，用來在 OOMOL 上打造 SaaS 平台：**你的**每個終端使用者都透過你的應用連結**他們自己的** Gmail / Slack / GitHub /…… 帳號，而你代表他們執行 action——也就是 [composio](https://composio.dev) / [pipedream](https://pipedream.com/docs/connect) 的「託管驗證（managed auth）」模式。

它是一個**獨立的用戶端**，用 **project API 金鑰**（`oo_proj_…`）建構。它只暴露以 project 為範圍的操作——與個人用的 `Connector` 完全不同（金鑰、方法與型別都不一樣），所以不會搞混：

```ts
import { ProjectConnector } from "@oomol-lab/connector";

const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! }); // oo_proj_...
```

用一個由你自訂、不透明的 `externalUserId` 來識別每位終端使用者。

### OAuth——建立連結，再等待完成

```ts
// Returns a pending connection request — send your user to `.authorizationUrl` to authorize.
const request = await project.connect.oauth("user_42", { service: "gmail", connectionName: "work" });
redirectUserTo(request.authorizationUrl);

// Poll until the user finishes (or it fails / expires); returns the final connection request.
const connected = await project.waitForConnection(request);
```

### API 金鑰／自訂憑證——同步，無需等待

```ts
const account = await project.connect.apiKey("user_42", { service: "openai", apiKey: "sk-..." });
await project.connect.customCredential("user_42", { service: "jira", values: { email, token } });
```

### 使用者連接的是哪個第三方帳號

```ts
// The third-party account holder behind a connected account — provider id, handle, display name,
// avatar, email (when the granted scopes expose it). Perfect for a "connected as …" UI.
const { service, profile, fetchedAt } = await project.getUserProfile(account.connectedAccountId);
console.log(`${service}: ${profile.displayName ?? profile.username}`);
```

### 代表使用者執行

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

### 限定於單一使用者

```ts
const user = project.forUser("user_42"); // bind the end-user once; drop the repeated id
await user.connect.oauth({ service: "gmail" });
await user.execute("gmail.search_threads", { query: "from:ceo" });
```

`project.execute` 重用與核心路徑相同的 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) 註冊表——已註冊的 action 會得到精確的輸入／輸出，其餘的則保持寬鬆可呼叫。

> [!NOTE]
> `connectionName` 是一個 connection 的唯一名稱：你在 `connect.*` 上指定它，然後把它作為 `execute` 的 `connectionName` 傳回，以鎖定那個帳號（gateway 在傳輸層的欄位名是 `alias`）。終端使用者則一律是 `externalUserId`。用 API 金鑰或自訂憑證連接是同步的——只有 OAuth 需要 `waitForConnection`。

**從 composio / pipedream 過來的嗎？**

| composio / pipedream | `@oomol-lab/connector` |
| --- | --- |
| `userId` / `external_user_id` | `externalUserId` |
| `connectedAccounts.initiate` / `createConnectToken` (OAuth) | `project.connect.oauth` |
| `connectedAccounts.initiate` + `AuthScheme.APIKey` | `project.connect.apiKey` |
| `waitForConnection()` | `project.waitForConnection()` |
| `tools.execute(slug, { userId, arguments })` | `project.execute(externalUserId, actionId, input)` |
| `composio.getEntity(userId)` | `project.forUser(externalUserId)` |

完整可執行的生命週期——[`examples/project.ts`](../../examples/project.ts)。

## 自架執行環境

自己在跑開源的 Connector 伺服器嗎（localhost、Docker、你自己的基礎設施）？**`OpenConnector`** 就是為它準備的個人用戶端——你熟悉的整套呼叫面（除了 `using()` 之外的一切），指向你自己的伺服器：

```ts
import { OpenConnector } from "@oomol-lab/connector";

const open = new OpenConnector(); // defaults to http://localhost:3000; a fresh instance needs no auth

await open.execute("hackernews.get_top_stories", {}); // path 1 — dynamic string
await open.gmail.search_threads({ query: "from:boss" }); // path 2 — namespace sugar, same registry types
await open.proxy("github", { endpoint: "/user", method: "GET" }); // path 3 — passthrough (endpoint must be a relative path)
await open.catalog.search("send email", { limit: 5 }); // runtime extras: search, services, health
await open.apps.list();
```

驗證只需一個選用的**執行環境 token**（`oct_…`），在執行環境的 web console 中鑄造：

```ts
const open = new OpenConnector({
  baseUrl: "https://connect.internal.example.com", // the server ORIGIN — not a /v1 url
  runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // omit while the instance has no tokens
});
```

> [!NOTE]
> Connection、憑證與 OAuth 設定都在執行環境的 **web console** 中管理——那屬於伺服器管理，刻意排除在這個 SDK 之外。用戶端只消費 console 所設定好的內容；connection 的選取有兩層（逐次呼叫的 `connectionName` 覆蓋用戶端層級的預設值——沒有 `using()` 範圍，也沒有 `team`）。而且和託管用戶端一樣，當某個 service id 與成員名稱（`execute` / `executeRaw` / `health` / `proxy` / `catalog` / `apps`）衝突時，仍可透過 `execute("<service>.<action>", …)` 正常運作——只有它的 namespace sugar 會被遮蔽。

完整可執行導覽——[`examples/open.ts`](../../examples/open.ts)。

## 為什麼選這個 SDK？

- **零執行期相依** — `sideEffects: false`，只發佈 `dist`。它就是一個行程內（in-process）的 HTTP 用戶端，僅此而已。
- **無 codegen、無 CLI** — 沒有東西要產生或執行；安裝後直接呼叫。
- **預設寬鬆，按需精確** — 每個 action 都能立即呼叫；一次匯入一個 provider，逐步選用各 action 的型別，而缺少的型別永遠不會弄壞你的建置。
- **統一的介面** — 每次 provider 呼叫、每個錯誤、每次重試都遵循相同的形式。

## 參考

- **`oomol.proxy(service, { endpoint, method, query, headers, body })`** — 直通到上游 provider API（當還沒有 action 建模該端點時使用）。
- **`oomol.catalog.action / .actions / .providers`** — 供動態 UI、驗證或 LLM 工具使用的執行期 JSON Schema。
- **`oomol.apps.list()`** — 對你已連接的應用進行唯讀檢視。
- **`oomol.executeRaw(...)`** — 與 `execute` 類似，但會回傳 `{ data, executionId, actionId, message }`。
- **`ProjectConnector`** — 一個獨立的用戶端（project API 金鑰），用來打造 SaaS 平台：`connect.oauth` / `connect.apiKey` / `connect.customCredential`、`waitForConnection`、用來讀取使用者在第三方平台身分的 `getUserProfile`、代表使用者的 `execute` / `executeRaw`，以及用來限定於單一使用者的 `forUser`。參見[為你的使用者連接帳號](#為你的使用者連接帳號)。
- **`OpenConnector`** — 供開源自架執行環境使用的個人用戶端：兩種呼叫路徑（`execute` 與 `open.<service>.<action>`）、`catalog` / `apps`（外加 `health`、`catalog.search` / `.services`、`apps.listByService` / `.authenticated`），以選用的執行環境 token 驗證。參見[自架執行環境](#自架執行環境)。

每個方法的可執行、經型別檢查的用法，請見 [`examples/`](../../examples)。

## 授權

[MIT](../../LICENSE)
