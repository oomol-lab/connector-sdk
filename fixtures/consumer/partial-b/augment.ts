// State 3 — B installed but only SOME providers imported: only `gmail` is registered.
// This is the key open-union case: actions of unimported providers (e.g. notion) must
// stay loose-callable (B lagging the backend must not cause false errors).
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
