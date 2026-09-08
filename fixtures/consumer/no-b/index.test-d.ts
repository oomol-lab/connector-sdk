// State 1 — B NOT installed (ActionRegistry empty). Everything must be loose-callable.
import { expectType, expectError, expectAssignable } from "tsd";
import { Connector, OpenConnector } from "@oomol-lab/connector";
import type { ConnectedApp, ConnectionAttempt, ConnectionAttemptStart } from "@oomol-lab/connector";

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
// Its namespace options are the open-runtime ones — no `team` (single-user server).
open.foo.bar({}, { connectionName: "work" });
expectError(open.foo.bar({}, { team: "acme" }));

// --- connect: identical surface on both personal clients, independent of the registry ---

// OAuth is asynchronous: a start payload to send the user to, then a poll.
expectType<Promise<ConnectionAttemptStart>>(oomol.connect.oauth("gmail"));
expectType<Promise<ConnectionAttemptStart>>(open.connect.oauth("gmail", { returnUri: "https://app.example.com/done" }));
expectType<Promise<ConnectionAttempt>>(oomol.connect.getAttempt("cr_1"));
expectType<Promise<ConnectionAttempt>>(oomol.connect.waitForConnection("cr_1", { pollIntervalMs: 500, maxWaitMs: 60_000 }));

// A start payload is accepted directly by waitForConnection (no unwrapping needed).
declare const started: ConnectionAttemptStart;
expectType<Promise<ConnectionAttempt>>(oomol.connect.waitForConnection(started));

// API key / custom credential are synchronous: they yield the ready connection.
expectType<Promise<ConnectedApp>>(oomol.connect.apiKey("openai", { apiKey: "sk-x" }));
expectType<Promise<ConnectedApp>>(oomol.connect.customCredential("jira", { values: { token: "t" } }));

// The client's own per-call options apply; `team` exists only on the hosted client.
oomol.connect.oauth("gmail", {}, { team: "acme", timeoutMs: 5_000 });
open.connect.oauth("gmail", {}, { timeoutMs: 5_000 });
expectError(open.connect.oauth("gmail", {}, { team: "acme" }));

// Required inputs stay required, and the service is positional.
expectError(oomol.connect.apiKey("openai", {}));
expectError(oomol.connect.customCredential("jira", {}));
expectError(oomol.connect.oauth());
expectError(oomol.connect.oauth({ service: "gmail" }));

// The self-hosted client takes the admin token connection management needs.
new OpenConnector({ runtimeToken: "oct_x", adminToken: "adm_x" });
expectError(new OpenConnector({ adminToken: 1 }));
