// State 3 — partial registration (only gmail). Unregistered services stay loose,
// while the registered service stays precise — both in the SAME program.
import { expectType, expectError } from "tsd";
import { Connector, OpenConnector, ProjectConnector } from "@oomol-lab/connector";
import "./augment";

const oomol = new Connector({ apiKey: "k" });
const project = new ProjectConnector({ apiKey: "oo_proj_k" });
const open = new OpenConnector();

type SearchOut = { threads: Array<{ threadId: string; snippet: string }> };

// Unregistered action via execute → still compiles, loose Record (NO false error).
expectType<Promise<Record<string, any>>>(
  oomol.execute("notion.create_page", { title: "x" }),
);
// Unregistered service via namespace → still loose-callable.
expectType<Promise<Record<string, any>>>(oomol.notion.create_page({ title: "x" }));
expectType<Promise<Record<string, any>>>(oomol.notion.create_page());

// Registered gmail stays PRECISE for its registered action.
expectType<Promise<SearchOut>>(oomol.gmail.search_threads({ query: "x" }));
expectError(oomol.gmail.search_threads({})); // still errors: missing required `query`
expectError(oomol.gmail.search_threads({ query: 123 })); // still errors: wrong type

// An UNREGISTERED ACTION on the REGISTERED gmail service must stay loose-callable, so the
// namespace path matches the dynamic `execute` path when the types lag the backend.
expectType<Promise<Record<string, any>>>(oomol.gmail.brand_new_action({ anything: 1 }));
expectType<Promise<Record<string, any>>>(
  oomol.execute("gmail.brand_new_action", { anything: 1 }),
);

// Unregistered loose path accepts arbitrary fields (no schema to check against).
oomol.notion.create_page({ anything: 1, goes: "here" });

// ProjectConnector.execute mirrors the core path: registered → precise, unregistered → loose Record.
expectType<Promise<SearchOut>>(project.execute("u", "gmail.search_threads", { query: "x" }));
expectType<Promise<Record<string, any>>>(
  project.execute("u", "notion.create_page", { title: "x" }),
);

// Separation: ProjectConnector exposes ONLY project-scoped operations — never the personal surface.
expectError(project.proxy);
expectError(project.catalog);
expectError(project.apps);
expectError(project.using);
expectError(project.gmail); // closed ProjectApi has no service namespaces

// OpenConnector namespaces stay in lockstep: registered precise, unregistered loose — same program.
expectType<Promise<SearchOut>>(open.gmail.search_threads({ query: "x" }));
expectError(open.gmail.search_threads({})); // still errors: missing required `query`
expectType<Promise<Record<string, any>>>(open.gmail.brand_new_action({ anything: 1 }));
expectType<Promise<Record<string, any>>>(open.notion.create_page({ title: "x" }));
// BOTH loose fallbacks of the augmented branch carry the open-runtime options — a regression to
// the default CallOptions would let the hosted-only `organization` slip through unnoticed.
expectError(open.gmail.brand_new_action({ anything: 1 }, { organization: "acme" }));
expectError(open.notion.create_page({ title: "x" }, { organization: "acme" }));
