/**
 * Connect an account on YOUR OWN account — the three authentication modes.
 *
 * Run with a real API key. Each flow needs the credential IT connects, and is skipped when that
 * variable is unset, so the OAuth tour alone needs nothing beyond your OOMOL key:
 *
 *   OOMOL_API_KEY=api-...                          # required — authorizes every call below
 *   OPENAI_API_KEY=sk-...                          # optional — runs the `apiKey()` flow
 *   JIRA_SITE=... JIRA_EMAIL=... JIRA_TOKEN=...    # optional — runs the `customCredential()` flow
 *   OOMOL_CONNECT_URL=http://localhost:3000        # optional — runs the self-hosted flow
 *
 *   OOMOL_API_KEY=api-... bun run examples/connect.ts
 *
 * Permission note: these calls are management operations. The key's user must be `creator` or
 * `admin` of the effective team — a plain member is refused by the gateway's policy layer with a
 * 403 before the request lands. (Running actions needs no such role.)
 *
 * Not to be confused with `ProjectConnector` (examples/project.ts), which connects accounts for
 * YOUR END-USERS. This file is about the account the API key itself belongs to.
 */
import { Connector, ConnectorError, OpenConnector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });

async function oauth() {
  // ASYNCHRONOUS. Nothing is stored until the user finishes in the browser.
  const started = await oomol.connect.oauth("gmail", {
    // Where the gateway sends the browser once the callback completes. Optional: without it the
    // gateway renders its own result page. `status` / `service` are appended to this URL.
    returnUri: "https://app.example.com/oauth/done",
    // Optional: request a subset of the provider's declared authorization options. Omit for all.
    // authorizationOptionIds: ["gmail.readonly"],
  });

  console.log("send the user here:", started.authorizationUrl);
  console.log("poll handle:", started.connectionRequestId, "expires", started.expiresAt);

  // Poll until the user finishes. Terminal statuses (connected / failed / expired) all RESOLVE —
  // only exhausting `maxWaitMs` throws, with code `client_wait_timeout`.
  const settled = await oomol.connect.waitForConnection(started, {
    pollIntervalMs: 2_000,
    maxWaitMs: 10 * 60_000,
  });

  if (settled.status === "connected") {
    console.log("connected — new connection id:", settled.appId);
  } else {
    console.log("not connected:", settled.status, settled.errorCode, settled.errorMessage);
  }

  // A one-shot status read, when you drive your own polling (or resume after a restart).
  console.log("read back:", (await oomol.connect.getAttempt(started.connectionRequestId)).status);
}

async function apiKey(providerKey: string) {
  // SYNCHRONOUS: the gateway validates the key against the provider and stores it in this one call.
  const app = await oomol.connect.apiKey("openai", {
    apiKey: providerKey, // the UPSTREAM provider's key, never your OOMOL key
    comment: "billing account",
    // Providers that need more than a key declare extra fields — see catalog.providers().
    // extra: { baseUrl: "https://eu.example.com" },
  });
  console.log("ready:", app.id, app.service, app.connectionName);
}

async function customCredential(values: Record<string, string>) {
  // SYNCHRONOUS too. `values` is keyed by the provider's declared credential field keys.
  const app = await oomol.connect.customCredential("jira", { values });
  console.log("ready:", app.id, app.connectionName);

  // The connection is immediately usable — select it by name on any call.
  // await oomol.jira.create_issue({ ... }, { connectionName: app.connectionName ?? undefined });
}

/**
 * The same three modes against a SELF-HOSTED runtime. Identical surface, one difference that
 * matters: connection management is admin-scoped there, so it needs the runtime's ADMIN token.
 * A runtime token (`oct_…`) is rejected on these routes, so the SDK never sends one for them —
 * `connect.*` carries `adminToken`, every other call carries `runtimeToken`.
 */
async function selfHosted(baseUrl: string) {
  const open = new OpenConnector({
    baseUrl, // the server ORIGIN, not a /v1 url
    runtimeToken: process.env.OOMOL_CONNECT_RUNTIME_TOKEN, // runs actions, reads the catalog
    adminToken: process.env.OOMOL_CONNECT_ADMIN_TOKEN, // required by connect.* only
  });

  const started = await open.connect.oauth("gmail", { returnUri: "http://localhost:5173/oauth/done" });
  console.log("send the user here:", started.authorizationUrl);
  const settled = await open.connect.waitForConnection(started);
  console.log("settled as:", settled.status, settled.appId);

  // The credential modes are synchronous here too.
  const openai = await open.connect.apiKey("openai", { apiKey: process.env.OPENAI_API_KEY ?? "sk-demo" });
  console.log("ready:", openai.id, openai.connectionName);

  // The self-hosted permission bar depends on how the runtime is configured. A runtime with no
  // authentication at all accepts these unauthenticated. Once runtime tokens are in play an admin
  // token becomes mandatory: without one the runtime answers 403 ("Configure an admin token to
  // manage connections"), and with one configured a runtime token (`oct_…`) is 401.
}

async function main() {
  try {
    await oauth();

    // Each credential flow sends a REAL secret upstream, so run only the ones you configured —
    // firing them unset would just ask the gateway to validate an empty credential.
    const providerKey = process.env.OPENAI_API_KEY;
    if (providerKey) await apiKey(providerKey);
    else console.log("skipping apiKey(): set OPENAI_API_KEY to run it");

    const { JIRA_SITE: site, JIRA_EMAIL: email, JIRA_TOKEN: token } = process.env;
    if (site && email && token) await customCredential({ site, email, token });
    else console.log("skipping customCredential(): set JIRA_SITE, JIRA_EMAIL and JIRA_TOKEN to run it");

    const openUrl = process.env.OOMOL_CONNECT_URL;
    if (openUrl) await selfHosted(openUrl);
    else console.log("skipping selfHosted(): set OOMOL_CONNECT_URL to run it");
  } catch (err) {
    if (err instanceof ConnectorError) {
      // Worth branching on: `user_oauth_client_required` (409, no OAuth client configured for this
      // provider yet), `invalid_input` (400 bad field / 403 "team manager role required" — check
      // `status`, not just the code), `connection_alias_conflict` (409), and on a self-hosted
      // runtime `unauthorized` (401, the admin token is wrong or a runtime token was sent) or
      // `forbidden` (403, the runtime enforces auth but has no admin token configured yet).
      console.error(`[${err.status}] ${err.code}: ${err.message}`);
      return;
    }
    throw err;
  }
}

await main();
