// Mock of what `@oomol-lab/connector-types/gmail` emits: a declaration merge that fills one
// entry of `ActionRegistry`. The side-effect import keeps the core module in the type graph
// (mirrors the real `.d.ts` pattern of the generated types package).
import "@oomol-lab/connector";

declare module "@oomol-lab/connector" {
  interface ActionRegistry {
    "gmail.search_threads": {
      input: {
        query: string;
        maxResults?: number;
      };
      output: {
        threads: Array<{ threadId: string; snippet: string }>;
      };
    };
  }
}
