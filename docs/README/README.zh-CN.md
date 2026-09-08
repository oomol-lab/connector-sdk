<div align="center">

# @oomol-lab/connector

[English](../../README.md) · **简体中文** · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md) · [Français](./README.fr.md)

[![npm](https://img.shields.io/npm/v/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![CI](https://img.shields.io/github/actions/workflow/status/oomol-lab/connector-sdk/ci.yml?branch=main&label=CI)](https://github.com/oomol-lab/connector-sdk/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@oomol-lab/connector)](https://bundlephobia.com/package/@oomol-lab/connector)
[![types](https://img.shields.io/npm/types/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

</div>

**一行带类型的代码,即可调用任意 connector action。** 面向 OOMOL Connector 网关的轻量、零依赖 HTTP 客户端——运行 action、代理上游 API、检视目录。认证、OAuth 与凭证都存放在网关上;SDK 只负责这一次带类型的调用。

**零运行时依赖。** 在宽松类型下即可完整工作——安装 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) 即可点亮每个 action 的精确类型与 JSDoc。无需代码生成,无需 CLI。

```ts
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! }); // → Authorization: Bearer <apiKey>

// Path 1 — dynamic string, always callable
const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });

// Path 2 — namespace sugar, same call underneath
const r = await oomol.gmail.search_threads({ query: "from:boss" });
```

> [!TIP]
> **在为*别人*构建,或者想自己跑服务端?** 本页讲的是默认的 `Connector`——在**你自己的**连接上运行 action。同一个包里还有另外两个同源客户端:
> - **[为你的用户连接账户](#为你的用户连接账户)** — `ProjectConnector`:你的终端用户关联*他们自己的* Gmail / Slack / GitHub / …… 账户,由你代表他们运行 action(即 composio / pipedream 的托管认证模式)。
> - **[自托管运行时](#自托管运行时)** — `OpenConnector`:同样的类型化调用,指向你自己托管的开源 Connector 服务端。

## 获取 API 密钥

你需要一个 OOMOL Connector API 密钥(形如 `api_…`)。把它设置为 `OOMOL_API_KEY` 即可开始——SDK 从不在本地校验密钥;每次请求都由网关授权。

<https://console.oomol.com/api-key>

## 安装

```sh
npm install @oomol-lab/connector   # or: bun add / pnpm add / yarn add
```

需要 Node ≥ 18(内置 `fetch` / `AbortController`)。可运行示例使用 Bun;库本身与运行时无关。

## 核心概念

没有架构需要学习——只有五个词,因为所有繁重工作都发生在网关上:

- **Gateway(网关)** — 本客户端所对接的、由 OOMOL Connector 托管的服务。它保管凭证、实际执行对提供方的调用,并返回统一的响应封装。SDK 在本地**不**运行任何集成逻辑;它只负责构造请求、解析回复。
- **Provider / service(提供方 / 服务)** — 一个第三方 API(`gmail`、`slack`、`github`、`notion`……)。它就是 action id 中的 `<service>` 前缀。
- **Action** — 提供方上的一个操作,以 `"<service>.<action>"` 标识(例如 `gmail.search_threads`)。你*调用* action,而不*定义*它们——它们存在于网关上。
- **Connection(连接)** — 某个提供方已存储、已授权的凭证。你从不接触令牌;只需通过 `connectionName` 指定要使用哪个连接。凭证生命周期由网关掌管:`connect` 可以发起授权,但令牌、刷新与存储始终留在服务端。
- **Team(团队)** — 可选的租户范围限定。

## 你能构建什么

| 你想… | 使用 | 说明 |
| --- | --- | --- |
| 运行一个已建模的 action | `execute` / `executeRaw` | 带类型的一行调用。`executeRaw` 还会返回 `{ executionId, actionId, message }`。 |
| 访问尚未建模为 action 的端点 | `proxy` | 透传到上游 API,并由网关注入连接的凭证。 |
| 把 action 喂给 LLM / 构建动态表单 | `catalog` | 任意 action 或提供方的运行时 JSON Schema(2020-12)——`catalog.action` / `catalog.actions` / `catalog.providers`。 |
| 发现已连接的内容 | `apps.list` | 只读列出你已经关联的连接。 |
| 连接你自己的账户 | `connect` | `connect.oauth`(异步:授权 URL 加轮询)、`connect.apiKey` / `connect.customCredential`(同步)。需要团队 `creator`/`admin` 密钥。参见[连接你自己的账户](#连接你自己的账户)。 |
| 让*你的*用户连接*他们自己的*账户 | `ProjectConnector` | 一个独立的、项目范围的客户端,代表你的终端用户连接账户并为其运行 action。参见[为你的用户连接账户](#为你的用户连接账户)。 |
| 自行运行开源服务端 | `OpenConnector` | 面向你自托管的运行时,提供两种调用路径(`execute` 与 `open.<service>.<action>`)以及 `catalog` / `apps` / `health`。参见[自托管运行时](#自托管运行时)。 |

提供方与 action 的覆盖范围来自网关,而非本包。可在运行时通过 `oomol.catalog.providers()` 发现它们,精确的编译期类型所覆盖的提供方请参见 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types)。

## 精确类型(可选)

动态字符串路径对**任意** `actionId` 都能编译通过。已注册的 action 会获得字面量补全与精确的输入/输出;未注册的则降级为 `Record<string, any>` 而不会报错——当类型包落后于后端时,SDK 从不阻塞你。

安装 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types),并为你用到的**每个提供方各添加一条副作用导入**:

```ts
import "@oomol-lab/connector-types/gmail";   // precise types + JSDoc for gmail.*
import "@oomol-lab/connector-types/slack";   // …and slack.*
```

核心运行时从不依赖类型包,因此每个 action 至少都能以宽松方式调用。

> [!NOTE]
> 需要将 `moduleResolution` 设置为 `bundler`、`node16` 或 `nodenext`,子路径导入才能解析。配置细节参见 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types)。

## 配置

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

- **`team`** — 调用在哪个租户下运行。
- **`connectionName`** — 当某个提供方有多个连接时,指定使用*哪个*已存储的凭证。

按调用传入的选项(`team`、`connectionName`、`signal`、`timeoutMs`、`retries`)会覆盖 `using()` 作用域,而后者又会覆盖客户端默认值:

```ts
const work = oomol.using({ connectionName: "work" }); // immutable scoped sub-client
await work.gmail.search_threads({ query }, { signal: controller.signal, timeoutMs: 10_000 });
```

## 错误处理

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

## 实用范例

### 一次调用把反馈写入 Notion

把用户反馈推送到 Notion,通常意味着一套 Notion OAuth 集成、它们的 SDK,以及手工拼装的 block 负载 JSON。把这一切收敛为一次调用——反馈到达,你调用 `append_block`,它便作为新段落落在你页面的底部。

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

字符串路径完全一致——`oomol.execute("notion.append_block", { pageId, text })`。完整可运行版本见 [`examples/feedback-to-notion.ts`](../../examples/feedback-to-notion.ts)。

### 调用尚无对应 action 的端点

当网关尚未把某个端点建模为 action 时,用 `proxy` 直接访问它——相同的认证、相同的连接,原始的请求/响应。

```ts
const { status, data } = await oomol.proxy("github", {
  endpoint: "/repos/oomol-lab/connector-sdk/issues",
  method: "GET",
  query: { state: "open" },
});
```

## 连接你自己的账户

关联账户通常在控制台完成,但两个个人客户端也都能在代码里做。三种模式,两种结果形态:

```ts
// OAuth — ASYNCHRONOUS. Send the user to the URL, then poll.
const started = await oomol.connect.oauth("gmail", { returnUri: "https://app.example.com/done" });
console.log(started.authorizationUrl);

const settled = await oomol.connect.waitForConnection(started);
if (settled.status === "connected") console.log("connection id:", settled.appId);

// API key / custom credential — SYNCHRONOUS. The credential is validated and stored in one call.
const openai = await oomol.connect.apiKey("openai", { apiKey: process.env.OPENAI_API_KEY! });
const jira = await oomol.connect.customCredential("jira", {
  values: { site: "acme.atlassian.net", email: "me@acme.com", token: process.env.JIRA_TOKEN! },
});
```

`waitForConnection` 对所有终态都会**正常返回**:`connected`、`failed`(用户拒绝授权,或被更新的一次尝试顶替)以及 `expired`(用户始终没有完成)。只有 `maxWaitMs` 耗尽时它才抛错(你自己设定的值,或默认的 10 分钟),错误码为 `client_wait_timeout`。可重试的轮询失败(429、5xx、网络)不会结束等待,它只消耗一次轮询,并在下一轮重试,且仍在同一个上限之内。若你想自己控制轮询节奏,或在进程重启后恢复,请改用 `getAttempt(connectionRequestId)`。

| 方法 | 返回 | 说明 |
| --- | --- | --- |
| `connect.oauth(service, input?)` | `{ authorizationUrl, stateHandle, connectionRequestId, status, expiresAt }` | `input` 的 `returnUri`、`authorizationOptionIds`、`extra`、`secretExtra` 全部可选。轮询用 `connectionRequestId`,**不是** `stateHandle`。 |
| `connect.apiKey(service, { apiKey, extra?, comment? })` | 已就绪的连接 | `apiKey` 是**上游提供方**的密钥,绝不是你的 OOMOL 密钥。 |
| `connect.customCredential(service, { values, comment? })` | 已就绪的连接 | `values` 的键来自提供方声明的凭证字段。 |
| `connect.getAttempt(id)` | 一次 OAuth 尝试 | 在 `expiresAt` 之后 24 小时内仍可读取;未知 id 会以 `connection_request_not_found` 拒绝。 |
| `connect.waitForConnection(startOrId, opts?)` | 已落定的尝试 | `pollIntervalMs`(2 秒)、`maxWaitMs`(10 分钟,即授权窗口)。 |

> [!IMPORTANT]
> **这些是管理操作,权限门槛高于运行 action。** 在托管网关上,密钥所属用户必须是所在团队的 `creator` 或 `admin`;普通成员会被策略层以 403 拒绝,请求根本到不了后端。在自托管运行时上,门槛取决于你怎么配置:完全没开认证的运行时会直接接受这些未认证请求,但只要用上了运行时令牌,**admin** 令牌就变成必需的。没配 admin 令牌时运行时回 403(`Configure an admin token to manage connections`),配了之后运行时令牌(`oct_…`)会以 401 被拒绝。参见[自托管运行时](#自托管运行时)。

这个调用面有意不做两件事:**命名**连接(两个后端都自行分配名称,之后在控制台重命名)以及**删除**或重新授权连接。

完整可运行的示例导览见 [`examples/connect.ts`](../../examples/connect.ts)。

## 为你的用户连接账户

`Connector` 在**你自己的**连接上运行 action。**`ProjectConnector`** 则是本产品的另一半,用于在 OOMOL 之上构建 SaaS 平台:**你的**每一位终端用户都通过你的应用关联**他们自己的** Gmail / Slack / GitHub / …… 账户,而你代表他们运行 action——也就是 [composio](https://composio.dev) / [pipedream](https://pipedream.com/docs/connect) 所说的「托管认证(managed auth)」模式。

它是一个**独立的客户端**,用**项目 API 密钥**(`oo_proj_…`)构造。它只暴露项目范围的操作——与个人版 `Connector` 完全不同(密钥、方法与类型都不一样),因此不会混淆:

```ts
import { ProjectConnector } from "@oomol-lab/connector";

const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! }); // oo_proj_...
```

用你自选的、不透明的 `externalUserId` 来标识每一位终端用户。

### OAuth——创建链接,再等待完成

```ts
// Returns a pending connection request — send your user to `.authorizationUrl` to authorize.
const request = await project.connect.oauth("user_42", { service: "gmail", connectionName: "work" });
redirectUserTo(request.authorizationUrl);

// Poll until the user finishes (or it fails / expires); returns the final connection request.
const connected = await project.waitForConnection(request);
```

### API 密钥 / 自定义凭证——同步,无需等待

```ts
const account = await project.connect.apiKey("user_42", { service: "openai", apiKey: "sk-..." });
await project.connect.customCredential("user_42", { service: "jira", values: { email, token } });
```

### 用户连接的是哪个第三方账户

```ts
// The third-party account holder behind a connected account — provider id, handle, display name,
// avatar, email (when the granted scopes expose it). Perfect for a "connected as …" UI.
const { service, profile, fetchedAt } = await project.getUserProfile(account.connectedAccountId);
console.log(`${service}: ${profile.displayName ?? profile.username}`);
```

### 代表用户执行

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

### 限定到单个用户

```ts
const user = project.forUser("user_42"); // bind the end-user once; drop the repeated id
await user.connect.oauth({ service: "gmail" });
await user.execute("gmail.search_threads", { query: "from:ceo" });
```

`project.execute` 复用与核心路径相同的 [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) 注册表——已注册的 action 获得精确的输入/输出,其余的保持宽松可调用。

> [!NOTE]
> `connectionName` 是一个连接的唯一名称:你在 `connect.*` 上为它赋值,随后作为 `execute` 的 `connectionName` 传回,以指向那个账户(网关的传输字段是 `alias`)。终端用户始终是 `externalUserId`。通过 API 密钥或自定义凭证连接是同步的——只有 OAuth 需要 `waitForConnection`。

**从 composio / pipedream 迁移过来?**

| composio / pipedream | `@oomol-lab/connector` |
| --- | --- |
| `userId` / `external_user_id` | `externalUserId` |
| `connectedAccounts.initiate` / `createConnectToken` (OAuth) | `project.connect.oauth` |
| `connectedAccounts.initiate` + `AuthScheme.APIKey` | `project.connect.apiKey` |
| `waitForConnection()` | `project.waitForConnection()` |
| `tools.execute(slug, { userId, arguments })` | `project.execute(externalUserId, actionId, input)` |
| `composio.getEntity(userId)` | `project.forUser(externalUserId)` |

完整可运行的生命周期示例见 [`examples/project.ts`](../../examples/project.ts)。

## 自托管运行时

自己运行开源的 Connector 服务端(localhost、Docker、你自己的基础设施)?**`OpenConnector`** 就是为此准备的个人客户端——你熟悉的整套调用面(除 `using()` 之外的一切),指向你自己的服务器:

```ts
import { OpenConnector } from "@oomol-lab/connector";

const open = new OpenConnector(); // defaults to http://localhost:3000; a fresh instance needs no auth

await open.execute("hackernews.get_top_stories", {}); // path 1 — dynamic string
await open.gmail.search_threads({ query: "from:boss" }); // path 2 — namespace sugar, same registry types
await open.proxy("github", { endpoint: "/user", method: "GET" }); // path 3 — passthrough (endpoint must be a relative path)
await open.catalog.search("send email", { limit: 5 }); // runtime extras: search, services, health
await open.apps.list();
```

认证只有一个可选的**运行时令牌**(`oct_…`),在运行时的 Web 控制台中签发:

```ts
const open = new OpenConnector({
  baseUrl: "https://connect.internal.example.com", // the server ORIGIN — not a /v1 url
  runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // omit while the instance has no tokens
});
```

`connect` 在这里同样可用,形态与托管客户端完全一致,但运行时上的连接管理属于 **admin 作用域**,因此需要第二个令牌:

```ts
const open = new OpenConnector({
  runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // runs actions, reads the catalog
  adminToken: process.env.OOMOL_CONNECT_ADMIN_TOKEN, // required by `connect.*` only
});

const started = await open.connect.oauth("gmail", { returnUri: "http://localhost:5173/done" });
await open.connect.waitForConnection(started);
```

运行时会拒绝这些路由上的运行时令牌,所以 SDK 从不往那里发送它:`connect.*` 携带 `adminToken`,其余调用携带 `runtimeToken`。不配置 `adminToken` 时,`connect.*` 会以无认证方式发出,这正好对应没有配置 admin 令牌的运行时。

> [!NOTE]
> 连接管理的其余部分,包括删除连接、OAuth 客户端配置、签发令牌,仍在运行时的 **Web 控制台**中完成,有意排除在本 SDK 之外。连接选择有两层(按调用的 `connectionName` 覆盖客户端级默认值,没有 `using()` 作用域,也没有 `team`)。而且与托管客户端一样,当某个 service id 与成员名(`execute` / `executeRaw` / `health` / `proxy` / `catalog` / `apps` / `connect`)冲突时,仍可通过 `execute("<service>.<action>", …)` 正常工作,只是它的命名空间语法糖会被遮蔽。

完整可运行的示例导览见 [`examples/open.ts`](../../examples/open.ts)。

## 为什么选择这个 SDK?

- **零运行时依赖** — `sideEffects: false`,只发布 `dist`。它就是一个进程内的 HTTP 客户端,仅此而已。
- **无代码生成,无 CLI** — 没有东西需要生成或运行;安装即可调用。
- **默认宽松,按需精确** — 每个 action 都能立即调用;通过逐个提供方导入按需启用每个 action 的类型,而缺失的类型绝不会破坏你的构建。
- **统一的接口面** — 每一次提供方调用、每一个错误、每一次重试都遵循相同的形态。

## 参考

- **`oomol.proxy(service, { endpoint, method, query, headers, body })`** — 透传到上游提供方 API(当尚无 action 建模该端点时使用)。
- **`oomol.catalog.action / .actions / .providers`** — 用于动态 UI、校验或 LLM 工具的运行时 JSON Schema。
- **`oomol.apps.list()`** — 对你已连接应用的只读检视。
- **`oomol.connect.oauth / .apiKey / .customCredential`** — 连接你自己的账户,并用 `getAttempt` / `waitForConnection` 跟进一次 OAuth 尝试直到完成。属于管理作用域:托管端需要团队 `creator`/`admin` 密钥,自托管端需要 admin 令牌。参见[连接你自己的账户](#连接你自己的账户)。
- **`oomol.executeRaw(...)`** — 与 `execute` 类似,但返回 `{ data, executionId, actionId, message }`。
- **`ProjectConnector`** — 一个独立的客户端(项目 API 密钥),用于构建 SaaS 平台:`connect.oauth` / `connect.apiKey` / `connect.customCredential`、`waitForConnection`、用于读取用户在第三方平台身份的 `getUserProfile`、代表用户的 `execute` / `executeRaw`,以及用于限定到单个用户的 `forUser`。参见[为你的用户连接账户](#为你的用户连接账户)。
- **`OpenConnector`** — 面向开源自托管运行时的个人客户端:两种调用路径(`execute` 与 `open.<service>.<action>`)、`catalog` / `apps`(外加 `health`、`catalog.search` / `.services`、`apps.listByService` / `.authenticated`)以及 `connect`,由一个可选的运行时令牌进行认证(在任何启用了认证的运行时上,`connect` 另需 admin 令牌)。参见[自托管运行时](#自托管运行时)。

每个方法的可运行、经过类型检查的用法见 [`examples/`](../../examples)。

## 许可证

[MIT](../../LICENSE)
