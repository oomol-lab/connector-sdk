// State 1 — B NOT installed (ActionRegistry empty). Everything must be loose-callable.
import { expectType, expectError, expectAssignable } from "tsd";
import { Connector, OpenConnector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: "k" });
const open = new OpenConnector();

// Dynamic execute compiles for ANY actionId, output is the loose Record.
expectType<Promise<Record<string, any>>>(oomol.execute("anything.x", { a: 1 }));
expectType<Promise<Record<string, any>>>(oomol.execute("totally.unknown_action", {}));

// Loose namespace path is callable (input optional, output loose).
expectType<Promise<Record<string, any>>>(oomol.foo.bar({}));
expectAssignable<Promise<Record<string, any>>>(oomol.anything.whatever());

// Input is `Record<string, any>`, NOT `any`: primitives are rejected.
expectError(oomol.execute("anything.x", 123));
expectError(oomol.execute("anything.x", "nope"));
expectError(oomol.foo.bar(123));

// actionId must be a string.
expectError(oomol.execute(123, {}));

// using() returns a Connector.
expectType<Connector>(oomol.using({ connectionName: "work" }));

// OpenConnector mirrors both paths with the SAME loose registry seam.
expectType<Promise<Record<string, any>>>(open.execute("anything.x", { a: 1 }));
expectType<Promise<Record<string, any>>>(open.foo.bar({}));
expectAssignable<Promise<Record<string, any>>>(open.anything.whatever());
expectError(open.foo.bar(123)); // input is Record, not any
expectError(open.execute("anything.x", 123)); // execute input is Record, not any
expectError(open.execute(123, {})); // actionId must be a string
// Its namespace options are the open-runtime ones — no `organization` (single-user server).
open.foo.bar({}, { connectionName: "work" });
expectError(open.foo.bar({}, { organization: "acme" }));
