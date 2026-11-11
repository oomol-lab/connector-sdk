/**
 * Hosted Triggers — subscribe an end-user's connected account to provider events. New events arrive
 * at your project webhook as signed `trigger.message` deliveries (see `webhooks.ts`).
 *
 *   OOMOL_PROJECT_API_KEY=oo_proj_... CONNECTED_ACCOUNT_ID=... bun run examples/triggers.ts
 */
import { ConnectorError, ProjectConnector } from "@oomol-lab/connector";

const project = new ProjectConnector({ apiKey: process.env.OOMOL_PROJECT_API_KEY! });
const user = project.forUser("user_42");

async function main() {
  // The catalog is the same for every project; read a Trigger's config schema before subscribing.
  const types = await project.triggers.listTypes({ service: "googlesheets" });
  console.log("triggers:", types.map((type) => `${type.id} (${type.type})`));
  const rowAdded = await project.triggers.getType("googlesheets.on_row_added");
  console.log("config schema:", JSON.stringify(rowAdded.configSchema));

  try {
    // A stable idempotencyKey makes the subscribe call safe to repeat, even across restarts.
    const subscription = await user.triggers.subscribe(
      {
        connectedAccountId: process.env.CONNECTED_ACCOUNT_ID!,
        triggerId: "googlesheets.on_row_added",
        config: { spreadsheetId: "<spreadsheet-id>", sheet: "Orders" },
        intervalSeconds: 300,
      },
      { idempotencyKey: "orders-sheet-user_42" },
    );
    console.log("subscribed:", subscription.id, subscription.status, subscription.billing.state);

    // Pause, resume, change the interval, then clean up.
    await project.triggers.updateSubscription(subscription.id, { status: "paused" });
    await project.triggers.updateSubscription(subscription.id, { status: "active", intervalSeconds: 600 });
    const page = await user.triggers.listSubscriptions({ status: "active" });
    console.log(`active for user_42: ${page.total}`, page.data.map((item) => item.triggerId));
    await project.triggers.deleteSubscription(subscription.id);
  } catch (err) {
    // No active project webhook receives trigger.message for this account: data.reason says why.
    if (err instanceof ConnectorError && err.code === "trigger_delivery_unavailable") {
      console.error("configure a webhook first:", err.data);
      return;
    }
    throw err;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
