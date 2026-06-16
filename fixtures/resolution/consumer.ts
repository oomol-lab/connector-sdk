// Positive-only consumer used to prove the bare-specifier root import + declaration merge
// resolve and type-check across moduleResolution modes (bundler / node16 / nodenext /
// classic node10). The augmentation is inlined so the only module specifier under test is
// the bare `@oomol-lab/connector` (no relative-import extension noise). No `expectError`
// here, so it can be checked with plain `tsc --noEmit` per resolution mode.
import { Connector } from "@oomol-lab/connector";
import type { CallOptions, RawResult } from "@oomol-lab/connector";

declare module "@oomol-lab/connector" {
  interface ActionRegistry {
    "gmail.search_threads": {
      input: { query: string; maxResults?: number };
      output: { threads: Array<{ threadId: string; snippet: string }> };
    };
  }
}

const oomol = new Connector({ apiKey: "k" });

export async function precise() {
  // Registered (precise): output is the augmented type.
  const r = await oomol.gmail.search_threads({ query: "x", maxResults: 5 });
  const snippet: string = r.threads[0]!.snippet;

  // execute path agrees.
  const r2 = await oomol.execute("gmail.search_threads", { query: "x" });
  const threadId: string = r2.threads[0]!.threadId;

  // Unregistered (loose): still callable, Record output.
  const loose = await oomol.notion.create_page({ title: "x" });
  const looseVal: Record<string, any> = loose;

  // executeRaw exposes metadata.
  const raw: RawResult = await oomol.executeRaw("gmail.search_threads", { query: "x" });

  // using() with options.
  const opts: CallOptions = { accountAlias: "work" };
  await oomol.using({ organization: "org" }).gmail.search_threads({ query: "x" }, opts);

  // proxy passthrough is typed (field is `endpoint`, not `path`).
  const proxied = await oomol.proxy<{ login: string }>("github", {
    endpoint: "/user",
    method: "GET",
  });
  const login: string = proxied.data.login;

  // catalog introspection types (runtime JSON Schema, not augmented).
  const meta = await oomol.catalog.action("gmail.search_threads");
  const inputSchema: Record<string, unknown> = meta.inputSchema;
  const providers = await oomol.catalog.providers({ service: ["gmail", "slack"], q: "mail" });

  return { snippet, threadId, looseVal, raw, login, inputSchema, providers };
}
