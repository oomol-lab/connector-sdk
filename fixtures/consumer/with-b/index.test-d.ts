// State 2 — B installed AND the action under test is registered (see ./augment.ts).
// The registered action must be precise on both paths; wrong input must error.
import { expectType, expectError } from "tsd";
import { Connector } from "@oomol-lab/connector";
import "./augment";

const oomol = new Connector({ apiKey: "k" });

type SearchOut = { threads: Array<{ threadId: string; snippet: string }> };

// Precise output — path 1 (execute) and path 2 (namespace) agree.
expectType<Promise<SearchOut>>(oomol.execute("gmail.search_threads", { query: "x" }));
expectType<Promise<SearchOut>>(oomol.gmail.search_threads({ query: "x" }));

// Optional field accepted.
oomol.gmail.search_threads({ query: "x", maxResults: 10 });
oomol.execute("gmail.search_threads", { query: "x", maxResults: 10 });

// --- negative assertions (the loose fallback must NOT weaken these) ---
// namespace path
expectError(oomol.gmail.search_threads({})); // missing required `query`
expectError(oomol.gmail.search_threads({ query: 123 })); // wrong type
expectError(oomol.gmail.search_threads({ query: "x", bogus: 1 })); // excess property
expectError(oomol.gmail.search_threads({ maxResults: 10 })); // missing required `query`
// execute path
expectError(oomol.execute("gmail.search_threads", {})); // missing required
expectError(oomol.execute("gmail.search_threads", { query: 123 })); // wrong type
expectError(oomol.execute("gmail.search_threads", { query: "x", bogus: 1 })); // excess

// Wrong-typed actionId rejected (open union is `string`, not `any`).
expectError(oomol.execute(123, { query: "x" }));

// Still open: an UNREGISTERED action remains loose-callable (forward-compat),
// so a never-registered service stays a Record.
expectType<Promise<Record<string, any>>>(oomol.execute("slack.post_message", { text: "hi" }));
