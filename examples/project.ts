/**
 * ProjectConnector — connect third-party accounts for YOUR end-users, then act on their behalf.
 *
 * This is the composio / pipedream "managed auth" model: you are a platform built on OOMOL, and
 * each of your end-users (an opaque `externalUserId` you choose) links their own Gmail / Slack /
 * GitHub / … account through your app. `ProjectConnector` is a SEPARATE client from the personal
 * `Connector` — construct it with a PROJECT API key (`oo_proj_…`); it exposes only project-scoped
 * operations.
 *
 *   OOMOL_PROJECT_API_KEY=oo_proj_... bun run examples/project.ts
 *
 * For precise per-action input/output types + JSDoc on `project.execute`, install
 * `@oomol-lab/connector-types` and add one side-effect import per provider (e.g.
 * `import "@oomol-lab/connector-types/gmail";`). Without it, every action stays loosely typed.
 */
import { ConnectorError, ProjectConnector } from "@oomol-lab/connector";

// Construct with a PROJECT API key (oo_proj_...). Same Bearer transport as the personal client.
const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! });

// Your own identifier for the end-user you're connecting accounts for.
const EXTERNAL_USER_ID = "user_42";

async function main() {
  // --- OAuth: create a link, send the user to it, await completion --------------------------------
  // Returns a PENDING connection request — its `authorizationUrl` is where your user authorizes.
  const request = await project.connect.oauth(EXTERNAL_USER_ID, {
    service: "gmail",
    connectionName: "work", // the name to assign; reuse it later to target this account
    returnUri: "https://app.example.com/connected", // where the gateway returns the user afterwards
  });
  console.log("send your user to:", request.authorizationUrl);

  // Poll until the user finishes (or it fails / expires). api-key & custom-credential connects are
  // synchronous and need NO waiting — only OAuth does.
  const connected = await project.waitForConnection(request, { maxWaitMs: 5 * 60_000 });
  console.log("status:", connected.status, "account:", connected.connectedAccountId);

  // --- Non-OAuth: connect by API key (synchronous; returns a ready account) -----------------------
  const account = await project.connect.apiKey(EXTERNAL_USER_ID, {
    service: "openai",
    apiKey: "sk-the-end-users-own-key",
    connectionName: "default",
  });
  console.log("connected account:", account.connectedAccountId, "available:", account.available);

  // --- Execute an action on the user's behalf -----------------------------------------------------
  // The provider service is derived from the actionId prefix ("gmail"); the user's latest active
  // account is used unless you pass `connectionName` / `connectedAccountId`.
  const out = await project.execute(
    EXTERNAL_USER_ID,
    "gmail.search_threads",
    { query: "is:unread" },
    { connectionName: "work" },
  );
  console.log("output:", out);

  // --- Scoped sub-client: bind the end-user once, drop the repeated id ----------------------------
  const user = project.forUser(EXTERNAL_USER_ID);
  const slack = await user.connect.oauth({ service: "slack" });
  await user.waitForConnection(slack);
  const raw = await user.executeRaw("slack.post_message", { channel: "#general", text: "shipped" });
  console.log("executionId:", raw.executionId, "data:", raw.data);
}

main().catch((err) => {
  if (err instanceof ConnectorError) {
    // e.g. "provider_config_not_found", "connection_alias_conflict", "app_not_ready",
    // or the client-only "client_wait_timeout" when the user never finishes OAuth in time.
    console.error(`[${err.code}] ${err.message}`);
  } else {
    throw err;
  }
});
