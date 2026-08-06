<div align="center">

# @oomol-lab/connector

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · **Русский** · [Français](./README.fr.md)

[![npm](https://img.shields.io/npm/v/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![CI](https://img.shields.io/github/actions/workflow/status/oomol-lab/connector-sdk/ci.yml?branch=main&label=CI)](https://github.com/oomol-lab/connector-sdk/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@oomol-lab/connector)](https://bundlephobia.com/package/@oomol-lab/connector)
[![types](https://img.shields.io/npm/types/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

</div>

**Вызывайте любое действие коннектора одной типизированной строкой.** Тонкий HTTP-клиент без зависимостей для шлюза OOMOL Connector — выполняйте действия, проксируйте вышестоящие API и исследуйте каталог. Аутентификация, OAuth и учётные данные живут на шлюзе; SDK — это просто типизированный вызов.

**Ноль зависимостей во время выполнения.** Полностью работает со свободной типизацией — добавьте [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types), чтобы включить точные типы для каждого действия + JSDoc. Никакой кодогенерации, никакого CLI.

```ts
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! }); // → Authorization: Bearer <apiKey>

// Path 1 — dynamic string, always callable
const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });

// Path 2 — namespace sugar, same call underneath
const r = await oomol.gmail.search_threads({ query: "from:boss" });
```

> [!TIP]
> **Создаёте для *других* людей или запускаете сервер самостоятельно?** Эта страница описывает `Connector` по умолчанию — действия на **ваших собственных** подключениях. В том же пакете есть ещё два родственных клиента:
> - **[Подключение аккаунтов для ваших пользователей](#подключение-аккаунтов-для-ваших-пользователей)** — `ProjectConnector`: ваши конечные пользователи подключают *свои* аккаунты Gmail / Slack / GitHub / …, а вы выполняете действия от их имени (модель управляемой аутентификации composio / pipedream).
> - **[Самостоятельно размещаемая среда выполнения](#самостоятельно-размещаемая-среда-выполнения)** — `OpenConnector`: те же типизированные вызовы, направленные на сервер Connector с открытым исходным кодом, который вы размещаете сами.

## Получение ключа API

Вам нужен ключ API для OOMOL Connector (в формате `api_…`). Задайте его в `OOMOL_API_KEY`, и всё готово — SDK никогда не проверяет ключ локально; шлюз авторизует каждый запрос.

<https://console.oomol.com/api-key>

## Установка

```sh
npm install @oomol-lab/connector   # or: bun add / pnpm add / yarn add
```

Требуется Node ≥ 18 (встроенные `fetch` / `AbortController`). Запускаемые примеры используют Bun; сама библиотека не зависит от среды выполнения.

## Концепции

Никакой архитектуры для изучения — всего пять слов, потому что вся тяжёлая работа выполняется на шлюзе:

- **Шлюз (Gateway)** — размещённый сервис OOMOL Connector, с которым общается этот клиент. Он хранит учётные данные, выполняет фактические вызовы провайдеров и возвращает единообразную оболочку. SDK **не** выполняет никакой логики интеграции локально; он лишь формирует запрос и разбирает ответ.
- **Провайдер / сервис** — сторонний API (`gmail`, `slack`, `github`, `notion`, …). Это префикс `<service>` в идентификаторе действия.
- **Действие (Action)** — одна операция у провайдера, обозначаемая как `"<service>.<action>"` (например, `gmail.search_threads`). Вы *вызываете* действия; вы не определяете их — они живут на шлюзе.
- **Подключение (Connection)** — сохранённые, уже авторизованные учётные данные для провайдера. Вы никогда не работаете с токенами; вы лишь указываете, какое подключение использовать, через `connectionName`. **OAuth и жизненный цикл учётных данных — задача шлюза, а не SDK.**
- **Команда (Team)** — необязательное разграничение по арендаторам.

## Что можно построить

| Хотите… | Используйте | Примечания |
| --- | --- | --- |
| Выполнить смоделированное действие | `execute` / `executeRaw` | Типизированный однострочник. `executeRaw` также возвращает `{ executionId, actionId, message }`. |
| Обратиться к эндпоинту, ещё не смоделированному как действие | `proxy` | Прямая передача к вышестоящему API, при этом учётные данные подключения внедряются шлюзом. |
| Передавать действия в LLM / строить динамические формы | `catalog` | JSON Schema (2020-12) во время выполнения для любого действия или провайдера — `catalog.action` / `catalog.actions` / `catalog.providers`. |
| Узнать, что подключено | `apps.list` | Список только для чтения подключений, которые вы уже связали. |
| Позволить *вашим* пользователям подключать *их* аккаунты | `ProjectConnector` | Отдельный клиент с областью действия проекта, чтобы подключать аккаунты от имени ваших конечных пользователей и выполнять действия для них. См. [Подключение аккаунтов для ваших пользователей](#подключение-аккаунтов-для-ваших-пользователей). |
| Запустить сервер с открытым исходным кодом самостоятельно | `OpenConnector` | Оба пути вызова (`execute` и `open.<service>.<action>`) + `catalog` / `apps` / `health` для вашей самостоятельно размещаемой среды выполнения. См. [Самостоятельно размещаемая среда выполнения](#самостоятельно-размещаемая-среда-выполнения). |

Охват провайдеров и действий обеспечивается шлюзом, а не этим пакетом. Узнавайте о нём во время выполнения с помощью `oomol.catalog.providers()`, а провайдеров с точными типами на этапе компиляции смотрите в [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types).

## Точные типы (необязательно)

Путь с динамической строкой компилируется для **любого** `actionId`. Зарегистрированные действия получают буквальное автодополнение + точные входные/выходные данные; незарегистрированные вырождаются в `Record<string, any>` вместо ошибки — SDK никогда не блокирует вас, когда пакет типов отстаёт от бэкенда.

Установите [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) и добавьте **один side-effect-импорт на каждый используемый провайдер**:

```ts
import "@oomol-lab/connector-types/gmail";   // precise types + JSDoc for gmail.*
import "@oomol-lab/connector-types/slack";   // …and slack.*
```

Ядро среды выполнения никогда не зависит от пакета типов, поэтому каждое действие остаётся как минимум свободно вызываемым.

> [!NOTE]
> Требуется, чтобы `moduleResolution` было установлено в `bundler`, `node16` или `nodenext`, чтобы импорты по подпутям разрешались. Подробности настройки смотрите в [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types).

## Конфигурация

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

- **`team`** — под каким арендатором выполняется вызов.
- **`connectionName`** — *какие* сохранённые учётные данные использовать, когда у вас более одного подключения для провайдера.

Параметры на уровне вызова (`team`, `connectionName`, `signal`, `timeoutMs`, `retries`) переопределяют область `using()`, которая переопределяет значения по умолчанию клиента:

```ts
const work = oomol.using({ connectionName: "work" }); // immutable scoped sub-client
await work.gmail.search_threads({ query }, { signal: controller.signal, timeoutMs: 10_000 });
```

## Обработка ошибок

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

## Рецепты

### Отзыв в Notion за один вызов

Обычно отправка отзывов пользователей в Notion означает интеграцию OAuth с Notion, их SDK и вручную собранный JSON с полезной нагрузкой блоков. Свернём всё это в один вызов — приходит отзыв, вы вызываете `append_block`, и он попадает новым абзацем внизу вашей страницы.

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

Строковый путь идентичен — `oomol.execute("notion.append_block", { pageId, text })`. Полная запускаемая версия — [`examples/feedback-to-notion.ts`](../../examples/feedback-to-notion.ts).

### Вызов эндпоинта, у которого ещё нет действия

Когда шлюз ещё не смоделировал эндпоинт как действие, обратитесь к нему напрямую через `proxy` — та же аутентификация, то же подключение, сырой запрос/ответ.

```ts
const { status, data } = await oomol.proxy("github", {
  endpoint: "/repos/oomol-lab/connector-sdk/issues",
  method: "GET",
  query: { state: "open" },
});
```

## Подключение аккаунтов для ваших пользователей

`Connector` выполняет действия на **ваших** подключениях. **`ProjectConnector`** — это другая половина продукта, для построения SaaS-платформы на OOMOL: каждый из **ваших** конечных пользователей подключает **свой собственный** аккаунт Gmail / Slack / GitHub / … через ваше приложение, а вы выполняете действия от их имени — модель «управляемой аутентификации» из [composio](https://composio.dev) / [pipedream](https://pipedream.com/docs/connect).

Это **отдельный клиент**, создаваемый с помощью **ключа API проекта** (`oo_proj_…`). Он предоставляет только операции с областью действия проекта — полностью отличается от персонального `Connector` (другой ключ, методы и типы), так что перепутать нечего:

```ts
import { ProjectConnector } from "@oomol-lab/connector";

const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! }); // oo_proj_...
```

Идентифицируйте каждого конечного пользователя непрозрачным `externalUserId`, который выбираете вы.

### OAuth — создайте ссылку, затем дождитесь завершения

```ts
// Returns a pending connection request — send your user to `.authorizationUrl` to authorize.
const request = await project.connect.oauth("user_42", { service: "gmail", connectionName: "work" });
redirectUserTo(request.authorizationUrl);

// Poll until the user finishes (or it fails / expires); returns the final connection request.
const connected = await project.waitForConnection(request);
```

### Ключ API / пользовательские учётные данные — синхронно, без ожидания

```ts
const account = await project.connect.apiKey("user_42", { service: "openai", apiKey: "sk-..." });
await project.connect.customCredential("user_42", { service: "jira", values: { email, token } });
```

### Под каким аккаунтом они подключились?

```ts
// The third-party account holder behind a connected account — provider id, handle, display name,
// avatar, email (when the granted scopes expose it). Perfect for a "connected as …" UI.
const { service, profile, fetchedAt } = await project.getUserProfile(account.connectedAccountId);
console.log(`${service}: ${profile.displayName ?? profile.username}`);
```

### Выполнение от имени пользователя

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

### Ограничение областью одного пользователя

```ts
const user = project.forUser("user_42"); // bind the end-user once; drop the repeated id
await user.connect.oauth({ service: "gmail" });
await user.execute("gmail.search_threads", { query: "from:ceo" });
```

`project.execute` использует тот же реестр [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types), что и основной путь — зарегистрированные действия получают точные входные/выходные данные, остальные остаются свободно вызываемыми.

> [!NOTE]
> `connectionName` — единственное имя подключения: вы назначаете его в `connect.*`, а затем передаёте обратно как `connectionName` в `execute`, чтобы нацелиться на этот аккаунт (полем на проводе у шлюза является `alias`). Конечный пользователь всегда `externalUserId`. Подключение по ключу API или пользовательским учётным данным синхронно — только OAuth требует `waitForConnection`.

**Переходите с composio / pipedream?**

| composio / pipedream | `@oomol-lab/connector` |
| --- | --- |
| `userId` / `external_user_id` | `externalUserId` |
| `connectedAccounts.initiate` / `createConnectToken` (OAuth) | `project.connect.oauth` |
| `connectedAccounts.initiate` + `AuthScheme.APIKey` | `project.connect.apiKey` |
| `waitForConnection()` | `project.waitForConnection()` |
| `tools.execute(slug, { userId, arguments })` | `project.execute(externalUserId, actionId, input)` |
| `composio.getEntity(userId)` | `project.forUser(externalUserId)` |

Полный запускаемый жизненный цикл — [`examples/project.ts`](../../examples/project.ts).

## Самостоятельно размещаемая среда выполнения

Запускаете сервер Connector с открытым исходным кодом самостоятельно (localhost, Docker, ваша собственная инфраструктура)? **`OpenConnector`** — это персональный клиент для него — тот же знакомый вам набор вызовов (всё, кроме `using()`), направленный на ваш собственный сервер:

```ts
import { OpenConnector } from "@oomol-lab/connector";

const open = new OpenConnector(); // defaults to http://localhost:3000; a fresh instance needs no auth

await open.execute("hackernews.get_top_stories", {}); // path 1 — dynamic string
await open.gmail.search_threads({ query: "from:boss" }); // path 2 — namespace sugar, same registry types
await open.proxy("github", { endpoint: "/user", method: "GET" }); // path 3 — passthrough (endpoint must be a relative path)
await open.catalog.search("send email", { limit: 5 }); // runtime extras: search, services, health
await open.apps.list();
```

Аутентификация — это единственный необязательный **токен среды выполнения** (`oct_…`), выпускаемый в веб-консоли среды выполнения:

```ts
const open = new OpenConnector({
  baseUrl: "https://connect.internal.example.com", // the server ORIGIN — not a /v1 url
  runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // omit while the instance has no tokens
});
```

> [!NOTE]
> Подключения, учётные данные и настройка OAuth управляются в **веб-консоли** среды выполнения — это администрирование сервера, намеренно вынесенное за пределы этого SDK. Клиент потребляет то, что настроено в консоли; выбор подключения имеет два уровня (`connectionName` на уровне вызова поверх значения по умолчанию на уровне клиента — здесь нет ни области `using()`, ни `team`). И, как и на размещённом клиенте, идентификатор сервиса, совпадающий с именем члена (`execute` / `executeRaw` / `health` / `proxy` / `catalog` / `apps`), продолжает работать через `execute("<service>.<action>", …)` — затеняется только его синтаксический сахар пространства имён.

Полный запускаемый обзор — [`examples/open.ts`](../../examples/open.ts).

## Почему этот SDK?

- **Ноль зависимостей во время выполнения** — `sideEffects: false`, поставляется только `dist`. Это внутрипроцессный HTTP-клиент, не более того.
- **Никакой кодогенерации, никакого CLI** — нечего генерировать или запускать; установите и вызывайте.
- **Свободно по умолчанию, точно по требованию** — каждое действие можно вызвать сразу; подключайте типы для отдельных действий по одному импорту провайдера за раз, и отсутствующие типы никогда не ломают вашу сборку.
- **Один единообразный интерфейс** — каждый вызов провайдера, каждая ошибка и каждая повторная попытка следуют одной и той же форме.

## Справочник

- **`oomol.proxy(service, { endpoint, method, query, headers, body })`** — прямая передача к вышестоящему API провайдера (используйте, когда ни одно действие ещё не моделирует эндпоинт).
- **`oomol.catalog.action / .actions / .providers`** — JSON Schema во время выполнения для динамических интерфейсов, валидации или инструментов LLM.
- **`oomol.apps.list()`** — интроспекция только для чтения ваших подключённых приложений.
- **`oomol.executeRaw(...)`** — как `execute`, но возвращает `{ data, executionId, actionId, message }`.
- **`ProjectConnector`** — отдельный клиент (ключ API проекта) для построения SaaS-платформы: `connect.oauth` / `connect.apiKey` / `connect.customCredential`, `waitForConnection`, `getUserProfile` для чтения личности пользователя на стороне провайдера, `execute` / `executeRaw` от имени пользователя и `forUser` для ограничения областью одного пользователя. См. [Подключение аккаунтов для ваших пользователей](#подключение-аккаунтов-для-ваших-пользователей).
- **`OpenConnector`** — персональный клиент для самостоятельно размещаемой среды выполнения с открытым исходным кодом: оба пути вызова (`execute` и `open.<service>.<action>`), `catalog` / `apps` (+ `health`, `catalog.search` / `.services`, `apps.listByService` / `.authenticated`), с аутентификацией по необязательному токену среды выполнения. См. [Самостоятельно размещаемая среда выполнения](#самостоятельно-размещаемая-среда-выполнения).

Смотрите [`examples/`](../../examples) для запускаемых, проверенных типами примеров использования каждого метода.

## Лицензия

[MIT](../../LICENSE)
