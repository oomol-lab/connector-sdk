/**
 * Connected apps — read-only introspection of the connections the gateway holds for you.
 * The SDK never creates or removes connections; that lives in the Connector dashboard.
 *
 *   OOMOL_API_KEY=api_... bun run examples/apps.ts
 */
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });

async function main() {
  const apps = await oomol.apps.list();
  console.log(`connected apps: ${apps.length}`);

  for (const app of apps) {
    // { id, service, status, connectionName, … } — `connectionName` is `null` when none is set.
    console.log(`- ${app.service}: id=${app.id} status=${app.status} connectionName=${app.connectionName}`);
  }

  // Targeting a specific connection: pass an app's `connectionName` back as the per-call selector.
  const withAlias = apps.find((a) => a.connectionName !== null);
  if (withAlias?.connectionName) {
    const out = await oomol.execute(
      `${withAlias.service}.some_action`,
      {},
      { connectionName: withAlias.connectionName },
    );
    console.log("scoped call output:", out);
  }
}

void main();
