// State 2 — B installed AND the action under test is registered (see ./augment.ts).
// The registered action must be precise on both paths; wrong input must error.
import { expectType, expectError } from "tsd";
import { Connector, OpenConnector, ProjectConnector } from "@oomol-lab/connector";
import "./augment";

const oomol = new Connector({ apiKey: "k" });
const project = new ProjectConnector({ apiKey: "oo_proj_k" });
const open = new OpenConnector();

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

// ProjectConnector.execute reuses the SAME registry seam — precise for registered actions, on both forms.
expectType<Promise<SearchOut>>(project.execute("u", "gmail.search_threads", { query: "x" }));
expectType<Promise<SearchOut>>(project.forUser("u").execute("gmail.search_threads", { query: "x" }));
expectError(project.execute("u", "gmail.search_threads", {})); // missing required `query`
expectError(project.execute("u", "gmail.search_threads", { query: 123 })); // wrong type

// Separation: ProjectConnector exposes ONLY project-scoped operations — never the personal surface.
expectError(project.proxy);
expectError(project.catalog);
expectError(project.apps);
expectError(project.using);
expectError(project.gmail); // closed ProjectApi has no service namespaces

// OpenConnector shares the registry seam — registered actions precise on BOTH paths.
expectType<Promise<SearchOut>>(open.execute("gmail.search_threads", { query: "x" }));
expectType<Promise<SearchOut>>(open.gmail.search_threads({ query: "x" }));
expectError(open.gmail.search_threads({})); // missing required `query`
expectError(open.gmail.search_threads({ query: 123 })); // wrong type
// The execute path is its own declaration — guard it as strictly as the hosted one.
expectError(open.execute("gmail.search_threads", {})); // missing required
expectError(open.execute("gmail.search_threads", { query: 123 })); // wrong type
expectError(open.execute("gmail.search_threads", { query: "x" }, { organization: "acme" }));
// Namespace options are the open-runtime ones: connectionName ok, `organization` rejected.
open.gmail.search_threads({ query: "x" }, { connectionName: "work" });
expectError(open.gmail.search_threads({ query: "x" }, { organization: "acme" }));
// The open client has no hosted-only METHODS: a non-reserved name like `proxy` or `using`
// resolves to a service NAMESPACE (an object), so calling it as a function must error.
expectError(open.proxy("github", { endpoint: "/user", method: "GET" }));
expectError(open.using({ connectionName: "work" }));
