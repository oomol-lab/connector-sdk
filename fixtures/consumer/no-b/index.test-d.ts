// State 1 — B NOT installed (ActionRegistry empty). Everything must be loose-callable.
import { expectType, expectError, expectAssignable } from "tsd";
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: "k" });

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
expectType<Connector>(oomol.using({ accountAlias: "work" }));
