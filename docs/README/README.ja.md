<div align="center">

# @oomol-lab/connector

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · **日本語** · [Русский](./README.ru.md) · [Français](./README.fr.md)

[![npm](https://img.shields.io/npm/v/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![CI](https://img.shields.io/github/actions/workflow/status/oomol-lab/connector-sdk/ci.yml?branch=main&label=CI)](https://github.com/oomol-lab/connector-sdk/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@oomol-lab/connector)](https://bundlephobia.com/package/@oomol-lab/connector)
[![types](https://img.shields.io/npm/types/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

</div>

**あらゆるコネクターアクションを、型付きの1行で呼び出す。** OOMOL Connector ゲートウェイ向けの、薄くて依存ゼロの HTTP クライアント — アクションの実行、上流 API へのプロキシ、カタログのイントロスペクションができます。認証・OAuth・認証情報はすべてゲートウェイ側にあり、SDK は型付きの呼び出しを担うだけです。

**ランタイム依存ゼロ。** 緩い型付けだけでも完全に動作します — [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) を追加すれば、アクションごとの正確な型と JSDoc が有効になります。コード生成も CLI も不要です。

```ts
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! }); // → Authorization: Bearer <apiKey>

// Path 1 — dynamic string, always callable
const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });

// Path 2 — namespace sugar, same call underneath
const r = await oomol.gmail.search_threads({ query: "from:boss" });
```

> [!TIP]
> **あなた*以外*の人向けに作っている、あるいはサーバーを自分で運用していますか?** このページはデフォルトの `Connector`(**あなた自身の**コネクションでアクションを実行)を扱います。同じパッケージには、姉妹クライアントがもう 2 つ含まれています:
> - **[ユーザーのアカウントを接続する](#ユーザーのアカウントを接続する)** — `ProjectConnector`:あなたのエンドユーザーが*自分の* Gmail / Slack / GitHub / … アカウントをリンクし、あなたが彼らの代わりにアクションを実行します(composio / pipedream のマネージド認証モデル)。
> - **[セルフホストランタイム](#セルフホストランタイム)** — `OpenConnector`:同じ型付きの呼び出しを、あなた自身がホストするオープンソースの Connector サーバーに向けます。

## API キーを取得する

OOMOL Connector の API キー（`api_…` のような形式）が必要です。これを `OOMOL_API_KEY` に設定すれば準備完了です — SDK がローカルでキーを検証することはなく、リクエストごとにゲートウェイが認可します。

<https://console.oomol.com/api-key>

## インストール

```sh
npm install @oomol-lab/connector   # or: bun add / pnpm add / yarn add
```

Node ≥ 18 が必要です（組み込みの `fetch` / `AbortController`）。実行可能なサンプルは Bun を使用していますが、ライブラリ自体はランタイム非依存です。

## コンセプト

学ぶべきアーキテクチャはありません — 重い処理はすべてゲートウェイ側で行われるため、覚えるのは5つの言葉だけです:

- **Gateway（ゲートウェイ）** — このクライアントが通信する、ホスト型の OOMOL Connector サービス。認証情報を保持し、実際のプロバイダー呼び出しを行い、統一されたエンベロープを返します。SDK はローカルで統合ロジックを**一切**実行せず、リクエストの構築とレスポンスの解析だけを行います。
- **Provider / service（プロバイダー / サービス）** — サードパーティ API（`gmail`、`slack`、`github`、`notion`、…）。アクション id の `<service>` プレフィックスにあたります。
- **Action（アクション）** — プロバイダー上の1つの操作で、`"<service>.<action>"`（例: `gmail.search_threads`）として識別されます。アクションは*呼び出す*ものであり、定義するものではありません — アクションはゲートウェイ上に存在します。
- **Connection（コネクション）** — プロバイダー向けに保存済みの、認可済み認証情報。トークンに触れることは一切なく、`connectionName` でどのコネクションを使うか指定するだけです。**OAuth と認証情報のライフサイクルはゲートウェイの役割であり、SDK の役割ではありません。**
- **Team（チーム）** — 任意のテナントスコープ指定。

## 作れるもの

| やりたいこと | 使うもの | 備考 |
| --- | --- | --- |
| モデル化されたアクションを実行する | `execute` / `executeRaw` | 型付きの1行呼び出し。`executeRaw` は `{ executionId, actionId, message }` も返します。 |
| まだアクションとしてモデル化されていないエンドポイントを叩く | `proxy` | 上流 API へのパススルー。コネクションの認証情報はゲートウェイが注入します。 |
| アクションを LLM に渡す / 動的フォームを構築する | `catalog` | 任意のアクションやプロバイダーのランタイム JSON Schema（2020-12） — `catalog.action` / `catalog.actions` / `catalog.providers`。 |
| 何が接続済みかを調べる | `apps.list` | すでにリンク済みのコネクションの読み取り専用リスト。 |
| *あなたの*ユーザーに*自分の*アカウントを接続させる | `ProjectConnector` | エンドユーザーの代わりにアカウントを接続し、彼らのためにアクションを実行する、プロジェクトスコープの別クライアント。[ユーザーのアカウントを接続する](#ユーザーのアカウントを接続する)を参照。 |
| オープンソースのサーバーを自分で運用する | `OpenConnector` | セルフホストのランタイムに対する両方の呼び出しパス（`execute` と `open.<service>.<action>`）＋ `catalog` / `apps` / `health`。[セルフホストランタイム](#セルフホストランタイム)を参照。 |

プロバイダーとアクションのカバー範囲は、このパッケージではなくゲートウェイから提供されます。実行時に `oomol.catalog.providers()` で調べられます。正確なコンパイル時型を持つプロバイダーについては [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) を参照してください。

## 正確な型（任意）

動的な文字列パスは**任意の** `actionId` に対してコンパイルできます。登録済みのアクションはリテラル補完と正確な入出力を得られます。未登録のものはエラーにならず `Record<string, any>` にフォールバックします — 型パッケージがバックエンドに遅れをとっていても、SDK があなたを止めることはありません。

[`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) をインストールし、使用する**プロバイダーごとに副作用インポートを1つ**追加します:

```ts
import "@oomol-lab/connector-types/gmail";   // precise types + JSDoc for gmail.*
import "@oomol-lab/connector-types/slack";   // …and slack.*
```

コアランタイムが型パッケージに依存することは決してないため、すべてのアクションは少なくとも緩く呼び出し可能な状態を保ちます。

> [!NOTE]
> サブパスインポートが解決されるよう、`moduleResolution` を `bundler`、`node16`、または `nodenext` に設定する必要があります。セットアップの詳細は [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) を参照してください。

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

- **`team`** — 呼び出しがどのテナントで実行されるか。
- **`connectionName`** — 1つのプロバイダーに複数のコネクションがある場合に、*どの*保存済み認証情報を使うか。

呼び出しごとのオプション（`team`、`connectionName`、`signal`、`timeoutMs`、`retries`）は `using()` スコープを上書きし、`using()` スコープはクライアントのデフォルトを上書きします:

```ts
const work = oomol.using({ connectionName: "work" }); // immutable scoped sub-client
await work.gmail.search_threads({ query }, { signal: controller.signal, timeoutMs: 10_000 });
```

## エラー処理

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

## レシピ

### フィードバックを1回の呼び出しで Notion へ

ユーザーのフィードバックを Notion に送るには、通常なら Notion の OAuth 連携、その SDK、そして手作りのブロックペイロード JSON が必要です。それらすべてを1回の呼び出しにまとめられます — フィードバックが届いたら `append_block` を呼ぶだけで、ページの最下部に新しい段落として追加されます。

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

文字列パスも同一です — `oomol.execute("notion.append_block", { pageId, text })`。完全に実行可能なバージョンは [`examples/feedback-to-notion.ts`](../../examples/feedback-to-notion.ts) を参照。

### まだアクションのないエンドポイントを呼び出す

ゲートウェイがエンドポイントをアクションとしてモデル化していない場合は、`proxy` で直接アクセスできます — 同じ認証、同じコネクション、生のリクエスト/レスポンスです。

```ts
const { status, data } = await oomol.proxy("github", {
  endpoint: "/repos/oomol-lab/connector-sdk/issues",
  method: "GET",
  query: { state: "open" },
});
```

## ユーザーのアカウントを接続する

`Connector` は**あなたの**コネクションでアクションを実行します。**`ProjectConnector`** は製品のもう半分で、OOMOL 上に SaaS プラットフォームを構築するためのものです。**あなたの**エンドユーザーそれぞれが、あなたのアプリを通じて**自分自身の** Gmail / Slack / GitHub / … アカウントをリンクし、あなたが彼らの代わりにアクションを実行します — [composio](https://composio.dev) / [pipedream](https://pipedream.com/docs/connect) の「マネージド認証」モデルです。

これは**別のクライアント**で、**プロジェクト API キー**（`oo_proj_…`）で構築します。公開するのはプロジェクトスコープの操作のみで、個人向けの `Connector` とは完全に別物です（キー・メソッド・型が異なります）。そのため取り違える心配はありません:

```ts
import { ProjectConnector } from "@oomol-lab/connector";

const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! }); // oo_proj_...
```

各エンドユーザーは、あなたが選んだ不透明な `externalUserId` で識別します。

### OAuth — リンクを作成し、完了を待つ

```ts
// Returns a pending connection request — send your user to `.authorizationUrl` to authorize.
const request = await project.connect.oauth("user_42", { service: "gmail", connectionName: "work" });
redirectUserTo(request.authorizationUrl);

// Poll until the user finishes (or it fails / expires); returns the final connection request.
const connected = await project.waitForConnection(request);
```

### API キー / カスタム認証情報 — 同期的、待機不要

```ts
const account = await project.connect.apiKey("user_42", { service: "openai", apiKey: "sk-..." });
await project.connect.customCredential("user_42", { service: "jira", values: { email, token } });
```

### どのアカウントで接続したか

```ts
// The third-party account holder behind a connected account — provider id, handle, display name,
// avatar, email (when the granted scopes expose it). Perfect for a "connected as …" UI.
const { service, profile, fetchedAt } = await project.getUserProfile(account.connectedAccountId);
console.log(`${service}: ${profile.displayName ?? profile.username}`);
```

### ユーザーの代わりに実行する

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

### 1人のユーザーにスコープする

```ts
const user = project.forUser("user_42"); // bind the end-user once; drop the repeated id
await user.connect.oauth({ service: "gmail" });
await user.execute("gmail.search_threads", { query: "from:ceo" });
```

`project.execute` はコアパスと同じ [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) レジストリを再利用します — 登録済みのアクションは正確な入出力を得られ、それ以外は緩く呼び出し可能なままです。

> [!NOTE]
> `connectionName` はコネクションを表す唯一の名前です: `connect.*` で割り当て、`execute` の `connectionName` として渡し直すことで、そのアカウントを対象にします（ゲートウェイのワイヤーフィールドは `alias`）。エンドユーザーは常に `externalUserId` です。API キーやカスタム認証情報での接続は同期的で、`waitForConnection` が必要なのは OAuth だけです。

**composio / pipedream から移行してきましたか?**

| composio / pipedream | `@oomol-lab/connector` |
| --- | --- |
| `userId` / `external_user_id` | `externalUserId` |
| `connectedAccounts.initiate` / `createConnectToken` (OAuth) | `project.connect.oauth` |
| `connectedAccounts.initiate` + `AuthScheme.APIKey` | `project.connect.apiKey` |
| `waitForConnection()` | `project.waitForConnection()` |
| `tools.execute(slug, { userId, arguments })` | `project.execute(externalUserId, actionId, input)` |
| `composio.getEntity(userId)` | `project.forUser(externalUserId)` |

完全に実行可能なライフサイクルは [`examples/project.ts`](../../examples/project.ts) を参照。

## セルフホストランタイム

オープンソースの Connector サーバーを自分で運用していますか?（localhost、Docker、あなた自身のインフラ）**`OpenConnector`** はそのための個人向けクライアントです — おなじみの呼び出し一式（`using()` を除くすべて）を、あなた自身のサーバーに向けます:

```ts
import { OpenConnector } from "@oomol-lab/connector";

const open = new OpenConnector(); // defaults to http://localhost:3000; a fresh instance needs no auth

await open.execute("hackernews.get_top_stories", {}); // path 1 — dynamic string
await open.gmail.search_threads({ query: "from:boss" }); // path 2 — namespace sugar, same registry types
await open.proxy("github", { endpoint: "/user", method: "GET" }); // path 3 — passthrough (endpoint must be a relative path)
await open.catalog.search("send email", { limit: 5 }); // runtime extras: search, services, health
await open.apps.list();
```

認証は任意の**ランタイムトークン**（`oct_…`）1つだけで、ランタイムの Web コンソールで発行します:

```ts
const open = new OpenConnector({
  baseUrl: "https://connect.internal.example.com", // the server ORIGIN — not a /v1 url
  runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // omit while the instance has no tokens
});
```

> [!NOTE]
> コネクション、認証情報、OAuth のセットアップは、ランタイムの **Web コンソール**で管理されます — これはサーバー管理であり、意図的にこの SDK の外に置かれています。クライアントはコンソールで設定された内容を利用します。コネクションの選択には2つの層があります（呼び出しごとの `connectionName` がクライアントレベルのデフォルトを上書きします — `using()` スコープも `team` もありません）。そしてホスト型クライアントと同様に、メンバー名（`execute` / `executeRaw` / `health` / `proxy` / `catalog` / `apps`）と衝突するサービス id は、`execute("<service>.<action>", …)` を通じて動作し続けます — シャドウされるのはその名前空間シュガーだけです。

完全に実行可能なツアーは [`examples/open.ts`](../../examples/open.ts) を参照。

## なぜこの SDK なのか?

- **ランタイム依存ゼロ** — `sideEffects: false` で、`dist` のみを配布します。プロセス内 HTTP クライアントであり、それ以上のものではありません。
- **コード生成なし、CLI なし** — 生成も実行も不要。インストールして呼び出すだけです。
- **デフォルトは緩く、必要に応じて正確に** — すべてのアクションはすぐに呼び出せます。プロバイダーのインポートを1つずつ追加してアクションごとの型を有効にでき、型が欠けていてもビルドが壊れることはありません。
- **1つの統一されたインターフェース** — すべてのプロバイダー呼び出し、すべてのエラー、すべてのリトライが同じ形に従います。

## リファレンス

- **`oomol.proxy(service, { endpoint, method, query, headers, body })`** — 上流プロバイダー API へのパススルー（まだアクションがそのエンドポイントをモデル化していない場合に使用）。
- **`oomol.catalog.action / .actions / .providers`** — 動的 UI、バリデーション、または LLM ツール向けのランタイム JSON Schema。
- **`oomol.apps.list()`** — 接続済みアプリの読み取り専用イントロスペクション。
- **`oomol.executeRaw(...)`** — `execute` と同様ですが、`{ data, executionId, actionId, message }` を返します。
- **`ProjectConnector`** — SaaS プラットフォームを構築するための別クライアント（プロジェクト API キー）: `connect.oauth` / `connect.apiKey` / `connect.customCredential`、`waitForConnection`、プロバイダー側のユーザー情報を読む `getUserProfile`、ユーザーの代わりに実行する `execute` / `executeRaw`、そして1人のユーザーにスコープする `forUser`。[ユーザーのアカウントを接続する](#ユーザーのアカウントを接続する)を参照。
- **`OpenConnector`** — オープンソースのセルフホストランタイム向けの個人用クライアント: 両方の呼び出しパス（`execute` と `open.<service>.<action>`）、`catalog` / `apps`（＋ `health`、`catalog.search` / `.services`、`apps.listByService` / `.authenticated`）、任意のランタイムトークンで認証されます。[セルフホストランタイム](#セルフホストランタイム)を参照。

すべてのメソッドの実行可能で型チェック済みの使用例は [`examples/`](../../examples) を参照してください。

## ライセンス

[MIT](../../LICENSE)
