<div align="center">

# @oomol-lab/connector

[English](../../README.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md) · **Français**

[![npm](https://img.shields.io/npm/v/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![CI](https://img.shields.io/github/actions/workflow/status/oomol-lab/connector-sdk/ci.yml?branch=main&label=CI)](https://github.com/oomol-lab/connector-sdk/actions/workflows/ci.yml)
[![npm downloads](https://img.shields.io/npm/dm/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@oomol-lab/connector)](https://bundlephobia.com/package/@oomol-lab/connector)
[![types](https://img.shields.io/npm/types/@oomol-lab/connector.svg)](https://www.npmjs.com/package/@oomol-lab/connector)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](../../LICENSE)

</div>

**Appelez n'importe quelle action de connecteur en une seule ligne typée.** Client HTTP léger et sans dépendance pour la passerelle OOMOL Connector — exécutez des actions, relayez les API en amont et explorez le catalogue. L'authentification, OAuth et les identifiants vivent sur la passerelle ; le SDK n'est que l'appel typé.

**Zéro dépendance d'exécution.** Fonctionne pleinement avec un typage souple — ajoutez [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) pour activer des types précis par action + JSDoc. Pas de génération de code, pas de CLI.

```ts
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! }); // → Authorization: Bearer <apiKey>

// Path 1 — dynamic string, always callable
const { threads } = await oomol.execute("gmail.search_threads", { query: "from:boss" });

// Path 2 — namespace sugar, same call underneath
const r = await oomol.gmail.search_threads({ query: "from:boss" });
```

> [!TIP]
> **Vous construisez pour *d'autres* personnes, ou vous faites tourner le serveur vous-même ?** Cette page couvre le `Connector` par défaut — des actions sur **vos propres** connexions. Deux clients frères sont livrés dans le même paquet :
> - **[Connecter les comptes de vos utilisateurs](#connecter-les-comptes-de-vos-utilisateurs)** — `ProjectConnector` : vos utilisateurs finaux relient *leurs* comptes Gmail / Slack / GitHub / …, et vous exécutez des actions en leur nom (le modèle d'authentification gérée de composio / pipedream).
> - **[Runtime auto-hébergé](#runtime-auto-hébergé)** — `OpenConnector` : les mêmes appels typés, pointés vers le serveur Connector open source que vous hébergez vous-même.

## Obtenir une clé API

Il vous faut une clé API OOMOL Connector (de la forme `api_…`). Définissez-la dans `OOMOL_API_KEY` et vous êtes prêt — le SDK ne valide jamais la clé localement ; la passerelle autorise chaque requête.

<https://console.oomol.com/api-key>

## Installation

```sh
npm install @oomol-lab/connector   # or: bun add / pnpm add / yarn add
```

Nécessite Node ≥ 18 (`fetch` / `AbortController` natifs). Les exemples exécutables utilisent Bun ; la bibliothèque elle-même est agnostique vis-à-vis du runtime.

## Concepts

Aucune architecture à apprendre — seulement cinq mots, car tout le gros du travail se fait sur la passerelle :

- **Passerelle** — le service hébergé OOMOL Connector avec lequel ce client communique. Elle détient les identifiants, effectue les véritables appels aux fournisseurs et renvoie une enveloppe uniforme. Le SDK n'exécute **aucune** logique d'intégration localement ; il ne fait que construire la requête et analyser la réponse.
- **Fournisseur / service** — une API tierce (`gmail`, `slack`, `github`, `notion`, …). C'est le préfixe `<service>` d'un identifiant d'action.
- **Action** — une opération sur un fournisseur, identifiée par `"<service>.<action>"` (par ex. `gmail.search_threads`). Vous *appelez* les actions ; vous ne les définissez pas — elles vivent sur la passerelle.
- **Connexion** — un identifiant stocké et déjà autorisé pour un fournisseur. Vous ne touchez jamais aux jetons ; vous nommez simplement la connexion à utiliser via `connectionName`. **OAuth et le cycle de vie des identifiants sont l'affaire de la passerelle, pas du SDK.**
- **Équipe** — cloisonnement optionnel par locataire.

## Ce que vous pouvez construire

| Vous voulez… | Utilisez | Notes |
| --- | --- | --- |
| Exécuter une action modélisée | `execute` / `executeRaw` | L'appel typé en une ligne. `executeRaw` renvoie aussi `{ executionId, actionId, message }`. |
| Atteindre un endpoint pas encore modélisé en action | `proxy` | Relais vers l'API en amont, avec les identifiants de la connexion injectés par la passerelle. |
| Fournir des actions à un LLM / construire des formulaires dynamiques | `catalog` | JSON Schema d'exécution (2020-12) pour n'importe quelle action ou fournisseur — `catalog.action` / `catalog.actions` / `catalog.providers`. |
| Découvrir ce qui est connecté | `apps.list` | Liste en lecture seule des connexions que vous avez déjà établies. |
| Laisser *vos* utilisateurs connecter *leurs* comptes | `ProjectConnector` | Un client distinct, à portée projet, pour connecter des comptes au nom de vos utilisateurs finaux et exécuter des actions pour eux. Voir [Connecter les comptes de vos utilisateurs](#connecter-les-comptes-de-vos-utilisateurs). |
| Exécuter vous-même le serveur open source | `OpenConnector` | Les deux voies d'appel (`execute` et `open.<service>.<action>`) + `catalog` / `apps` / `health` sur votre runtime auto-hébergé. Voir [Runtime auto-hébergé](#runtime-auto-hébergé). |

La couverture des fournisseurs et des actions provient de la passerelle, pas de ce package. Découvrez-la à l'exécution avec `oomol.catalog.providers()`, et consultez [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) pour les fournisseurs dotés de types précis à la compilation.

## Types précis (optionnel)

La voie par chaîne dynamique compile pour **n'importe quel** `actionId`. Les actions enregistrées bénéficient de la complétion littérale + d'entrées/sorties précises ; celles non enregistrées se rabattent sur `Record<string, any>` au lieu de provoquer une erreur — le SDK ne vous bloque jamais lorsque le package de types est en retard sur le backend.

Installez [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) et ajoutez **un import à effet de bord par fournisseur** que vous utilisez :

```ts
import "@oomol-lab/connector-types/gmail";   // precise types + JSDoc for gmail.*
import "@oomol-lab/connector-types/slack";   // …and slack.*
```

Le runtime central ne dépend jamais du package de types, donc chaque action reste au moins appelable de façon souple.

> [!NOTE]
> Nécessite `moduleResolution` réglé sur `bundler`, `node16` ou `nodenext` pour que les imports de sous-chemin se résolvent. Voir [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) pour les détails de configuration.

## Configuration

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

- **`team`** — sous quel locataire l'appel s'exécute.
- **`connectionName`** — *quel* identifiant stocké utiliser lorsque vous avez plusieurs connexions pour un fournisseur.

Les options par appel (`team`, `connectionName`, `signal`, `timeoutMs`, `retries`) l'emportent sur une portée `using()`, qui l'emporte sur les valeurs par défaut du client :

```ts
const work = oomol.using({ connectionName: "work" }); // immutable scoped sub-client
await work.gmail.search_threads({ query }, { signal: controller.signal, timeoutMs: 10_000 });
```

## Gestion des erreurs

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

## Recettes

### Retours vers Notion en un seul appel

Envoyer les retours des utilisateurs dans Notion implique normalement une intégration OAuth Notion, leur SDK et du JSON de charge utile de blocs construit à la main. Réduisez tout cela à un seul appel — un retour arrive, vous appelez `append_block`, et il atterrit sous forme de nouveau paragraphe au bas de votre page.

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

La voie par chaîne est identique — `oomol.execute("notion.append_block", { pageId, text })`. Version complète exécutable — [`examples/feedback-to-notion.ts`](../../examples/feedback-to-notion.ts).

### Appeler un endpoint qui n'a pas encore d'action

Lorsque la passerelle n'a pas modélisé un endpoint en action, atteignez-le directement avec `proxy` — même authentification, même connexion, requête/réponse brutes.

```ts
const { status, data } = await oomol.proxy("github", {
  endpoint: "/repos/oomol-lab/connector-sdk/issues",
  method: "GET",
  query: { state: "open" },
});
```

## Connecter les comptes de vos utilisateurs

`Connector` exécute des actions sur **vos** connexions. **`ProjectConnector`** est l'autre moitié du produit, pour bâtir une plateforme SaaS sur OOMOL : chacun de **vos** utilisateurs finaux relie **son propre** compte Gmail / Slack / GitHub / … via votre application, et vous exécutez des actions en son nom — le modèle « authentification gérée » de [composio](https://composio.dev) / [pipedream](https://pipedream.com/docs/connect).

C'est un **client distinct**, construit avec une **clé API de projet** (`oo_proj_…`). Il n'expose que des opérations à portée projet — entièrement distinct du `Connector` personnel (clé, méthodes et types différents), donc rien à confondre :

```ts
import { ProjectConnector } from "@oomol-lab/connector";

const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! }); // oo_proj_...
```

Identifiez chaque utilisateur final avec un `externalUserId` opaque de votre choix.

### OAuth — créer un lien, puis attendre la finalisation

```ts
// Returns a pending connection request — send your user to `.authorizationUrl` to authorize.
const request = await project.connect.oauth("user_42", { service: "gmail", connectionName: "work" });
redirectUserTo(request.authorizationUrl);

// Poll until the user finishes (or it fails / expires); returns the final connection request.
const connected = await project.waitForConnection(request);
```

### Clé API / identifiant personnalisé — synchrone, sans attente

```ts
const account = await project.connect.apiKey("user_42", { service: "openai", apiKey: "sk-..." });
await project.connect.customCredential("user_42", { service: "jira", values: { email, token } });
```

### Sous quel compte se sont-ils connectés ?

```ts
// The third-party account holder behind a connected account — provider id, handle, display name,
// avatar, email (when the granted scopes expose it). Perfect for a "connected as …" UI.
const { service, profile, fetchedAt } = await project.getUserProfile(account.connectedAccountId);
console.log(`${service}: ${profile.displayName ?? profile.username}`);
```

### Exécuter au nom de l'utilisateur

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

### Restreindre à un seul utilisateur

```ts
const user = project.forUser("user_42"); // bind the end-user once; drop the repeated id
await user.connect.oauth({ service: "gmail" });
await user.execute("gmail.search_threads", { query: "from:ceo" });
```

`project.execute` réutilise le même registre [`@oomol-lab/connector-types`](https://github.com/oomol-lab/connector-types) que la voie principale — les actions enregistrées obtiennent des entrées/sorties précises, les autres restent appelables de façon souple.

> [!NOTE]
> `connectionName` est le nom unique d'une connexion : vous l'attribuez sur `connect.*`, puis vous le repassez comme `connectionName` d'`execute` pour cibler ce compte (le champ réseau de la passerelle est `alias`). L'utilisateur final est toujours `externalUserId`. La connexion par clé API ou identifiant personnalisé est synchrone — seul OAuth nécessite `waitForConnection`.

**Vous venez de composio / pipedream ?**

| composio / pipedream | `@oomol-lab/connector` |
| --- | --- |
| `userId` / `external_user_id` | `externalUserId` |
| `connectedAccounts.initiate` / `createConnectToken` (OAuth) | `project.connect.oauth` |
| `connectedAccounts.initiate` + `AuthScheme.APIKey` | `project.connect.apiKey` |
| `waitForConnection()` | `project.waitForConnection()` |
| `tools.execute(slug, { userId, arguments })` | `project.execute(externalUserId, actionId, input)` |
| `composio.getEntity(userId)` | `project.forUser(externalUserId)` |

Cycle de vie complet exécutable — [`examples/project.ts`](../../examples/project.ts).

## Runtime auto-hébergé

Vous faites tourner vous-même le serveur Connector open source (localhost, Docker, votre propre infrastructure) ? **`OpenConnector`** en est le client personnel — la même surface d'appel que vous connaissez (tout sauf `using()`), pointée vers votre propre serveur :

```ts
import { OpenConnector } from "@oomol-lab/connector";

const open = new OpenConnector(); // defaults to http://localhost:3000; a fresh instance needs no auth

await open.execute("hackernews.get_top_stories", {}); // path 1 — dynamic string
await open.gmail.search_threads({ query: "from:boss" }); // path 2 — namespace sugar, same registry types
await open.proxy("github", { endpoint: "/user", method: "GET" }); // path 3 — passthrough (endpoint must be a relative path)
await open.catalog.search("send email", { limit: 5 }); // runtime extras: search, services, health
await open.apps.list();
```

L'authentification se résume à un unique **jeton de runtime** optionnel (`oct_…`), généré dans la console web du runtime :

```ts
const open = new OpenConnector({
  baseUrl: "https://connect.internal.example.com", // the server ORIGIN — not a /v1 url
  runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // omit while the instance has no tokens
});
```

> [!NOTE]
> Les connexions, les identifiants et la configuration OAuth se gèrent dans la **console web** du runtime — il s'agit d'administration serveur, délibérément hors de ce SDK. Le client consomme ce que la console a configuré ; la sélection de connexion comporte deux couches (le `connectionName` par appel l'emporte sur la valeur par défaut au niveau du client — il n'y a ni portée `using()` ni `team`). Et comme sur le client hébergé, un identifiant de service qui entre en collision avec un nom de membre (`execute` / `executeRaw` / `health` / `proxy` / `catalog` / `apps`) continue de fonctionner via `execute("<service>.<action>", …)` — seul son sucre de namespace est masqué.

Visite guidée complète exécutable — [`examples/open.ts`](../../examples/open.ts).

## Pourquoi ce SDK ?

- **Zéro dépendance d'exécution** — `sideEffects: false`, ne livre que `dist`. C'est un client HTTP en processus, rien de plus.
- **Pas de génération de code, pas de CLI** — rien à générer ni à exécuter ; installez et appelez.
- **Souple par défaut, précis sur demande** — chaque action est appelable immédiatement ; adoptez les types par action un import de fournisseur à la fois, et les types manquants ne cassent jamais votre build.
- **Une surface uniforme** — chaque appel de fournisseur, chaque erreur et chaque nouvelle tentative suit la même forme.

## Référence

- **`oomol.proxy(service, { endpoint, method, query, headers, body })`** — relais vers une API de fournisseur en amont (à utiliser quand aucune action ne modélise encore l'endpoint).
- **`oomol.catalog.action / .actions / .providers`** — JSON Schema d'exécution pour interfaces dynamiques, validation ou outils LLM.
- **`oomol.apps.list()`** — introspection en lecture seule de vos applications connectées.
- **`oomol.executeRaw(...)`** — comme `execute`, mais renvoie `{ data, executionId, actionId, message }`.
- **`ProjectConnector`** — un client distinct (clé API de projet) pour bâtir une plateforme SaaS : `connect.oauth` / `connect.apiKey` / `connect.customCredential`, `waitForConnection`, `getUserProfile` pour lire l'identité de l'utilisateur côté fournisseur, `execute` / `executeRaw` au nom d'un utilisateur, et `forUser` pour cibler un seul utilisateur. Voir [Connecter les comptes de vos utilisateurs](#connecter-les-comptes-de-vos-utilisateurs).
- **`OpenConnector`** — le client personnel pour le runtime open source auto-hébergé : les deux voies d'appel (`execute` et `open.<service>.<action>`), `catalog` / `apps` (+ `health`, `catalog.search` / `.services`, `apps.listByService` / `.authenticated`), authentifié par un jeton de runtime optionnel. Voir [Runtime auto-hébergé](#runtime-auto-hébergé).

Consultez [`examples/`](../../examples) pour un usage exécutable et vérifié par typage de chaque méthode.

## Licence

[MIT](../../LICENSE)
