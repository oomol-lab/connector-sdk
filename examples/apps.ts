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
    // { id, service, status, accountAlias, … } — `accountAlias` is `null` when none is set.
    console.log(`- ${app.service}: id=${app.id} status=${app.status} accountAlias=${app.accountAlias}`);
  }

  // Targeting a specific connection: pass an app's `accountAlias` back as the per-call selector.
  const withAlias = apps.find((a) => a.accountAlias !== null);
  if (withAlias?.accountAlias) {
    const out = await oomol.execute(
      `${withAlias.service}.some_action`,
      {},
      { accountAlias: withAlias.accountAlias },
    );
    console.log("scoped call output:", out);
  }
}

void main();
