/**
 * `connect` — create a connection on the caller's OWN account, for the personal clients.
 *
 * Both backends expose the same contract here (identical paths, request bodies, and payloads), so
 * one implementation serves the hosted {@link Connector} and the self-hosted {@link OpenConnector};
 * only the path prefix and the transport differ.
 *
 * Three authentication modes, two shapes of result:
 * - `oauth` is ASYNCHRONOUS — it returns an authorization URL to send the user to, plus a
 *   `connectionRequestId` to poll (`getAttempt` / `waitForConnection`).
 * - `apiKey` / `customCredential` are SYNCHRONOUS — the credential is validated and stored in the
 *   one call, which returns the ready connection.
 *
 * Permissions are NOT symmetric across the two backends, and the SDK cannot paper over that:
 * - hosted: the API key's user must be `creator` or `admin` of the effective team. A plain member
 *   is refused by the gateway's policy layer before the request reaches the connector.
 * - self-hosted: the runtime's ADMIN token is required; a runtime token (`oct_…`) is rejected with
 *   `unauthorized`. Pass it as `adminToken` when constructing the client.
 *
 * What this surface deliberately does NOT do: name the connection (both backends assign the name
 * themselves at connect time — rename it afterwards in the console), re-authorize an existing
 * connection, or delete one.
 */

import { ConnectorError } from "./errors";
import { abortErrorFrom, type Envelope } from "./http";
import type { ConnectedApp } from "./types";

/**
 * Lifecycle status of one OAuth authorization attempt. `expired` is derived by the backend at read
 * time once an `initiated` attempt passes its `expiresAt`. Open union (`| (string & {})`) so a new
 * backend status never breaks an exhaustive `switch` — matching `ConnectorErrorCode` / `ActionId`.
 */
export type ConnectionAttemptStatus = "initiated" | "connected" | "failed" | "expired" | (string & {});

/**
 * What `connect.oauth` returns: a started authorization. Send the user to `authorizationUrl`, then
 * poll with `connect.waitForConnection(start)`.
 */
export interface ConnectionAttemptStart {
  /** The provider authorization URL — send the user here to complete OAuth. */
  authorizationUrl: string;
  /** The one-shot OAuth state the callback consumes. NOT the polling key — use `connectionRequestId`. */
  stateHandle: string;
  /** Poll handle for this attempt. Pass it to `getAttempt` / `waitForConnection`. */
  connectionRequestId: string;
  /** Always `"initiated"`: a freshly started attempt. */
  status: "initiated";
  /** ISO-8601 timestamp when the authorization window closes (10 minutes out on both backends). */
  expiresAt: string;
}

/**
 * One OAuth authorization attempt, as read back while (or after) the user completes it. Starting a
 * new attempt for the same service supersedes any still-pending one, which then reads back as
 * `failed` with `errorCode: "request_superseded"`.
 */
export interface ConnectionAttempt {
  connectionRequestId: string;
  service: string;
  status: ConnectionAttemptStatus;
  /** The connection this attempt created once `connected`, else `null`. */
  appId: string | null;
  /** Connector error code when `status` is `failed`, else `null`. */
  errorCode: string | null;
  errorMessage: string | null;
  /** ISO-8601 timestamp when the authorization window closes. */
  expiresAt: string;
  /** Unix epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/** Input for `connect.oauth`. Every field is optional — `connect.oauth("gmail")` is valid. */
export interface ConnectOAuthInput {
  /**
   * URL the backend redirects the user to once the OAuth callback completes, with `status`
   * (`success` / `error`) and `service` appended (plus `code` / `message` on error). Scheme must be
   * `https:`, `http:`, or `oomol:`. Without it the callback renders the backend's own result page.
   */
  returnUri?: string;
  /**
   * Provider-declared authorization option ids to request (the provider's own scope bundles).
   * Omit to request every option the provider declares; passing this to a provider that declares
   * none is an `invalid_input` error.
   */
  authorizationOptionIds?: string[];
  /** Per-attempt overrides for the provider's connect-only OAuth client-config fields. */
  extra?: Record<string, unknown>;
  /** Same as {@link extra}, for the fields the provider marks secret. */
  secretExtra?: Record<string, string>;
}

/** Input for `connect.apiKey`. */
export interface ConnectApiKeyInput {
  /** The UPSTREAM provider's API key (e.g. an `sk-…`). Never the OOMOL key this client authenticates with. */
  apiKey: string;
  /** Provider-declared extra fields that accompany the key (e.g. `{ baseUrl }`). Validated by the backend. */
  extra?: Record<string, string>;
  /** Free-text note stored on the connection. */
  comment?: string | null;
}

/** Input for `connect.customCredential`. */
export interface ConnectCustomCredentialInput {
  /** Credential field values, keyed by the provider's declared field keys. Validated by the backend. */
  values: Record<string, string>;
  /** Free-text note stored on the connection. */
  comment?: string | null;
}

/**
 * Tuning for `waitForConnection`. `maxWaitMs` is the total wall-clock cap — the one you usually
 * want. `timeoutMs` (from the client's own call options) is the advanced PER-POLL HTTP timeout.
 * `signal` aborts the whole wait and is forwarded to each poll.
 */
export interface ConnectionWaitTuning {
  /** Delay between status polls. Default 2000ms. */
  pollIntervalMs?: number;
  /** Overall cap on how long to wait for the user to finish. Default 600_000ms (the authorization window). */
  maxWaitMs?: number;
}

/**
 * The `connect` namespace. `O` is the owning client's per-call options type (`CallOptions` on the
 * hosted client, `OpenCallOptions` on the self-hosted one).
 */
export interface ConnectApi<O> {
  /**
   * Start an OAuth authorization. ASYNCHRONOUS: returns the URL to send the user to plus a poll
   * handle — nothing is stored until the user finishes and the callback lands.
   */
  oauth(service: string, input?: ConnectOAuthInput, options?: O): Promise<ConnectionAttemptStart>;
  /** Connect with a provider API key. SYNCHRONOUS — returns the ready connection. */
  apiKey(service: string, input: ConnectApiKeyInput, options?: O): Promise<ConnectedApp>;
  /** Connect with provider-declared credential fields. SYNCHRONOUS — returns the ready connection. */
  customCredential(service: string, input: ConnectCustomCredentialInput, options?: O): Promise<ConnectedApp>;
  /**
   * Read one OAuth attempt by its `connectionRequestId`. Readable until 24h past `expiresAt`;
   * an unknown (or expired-out) id rejects with `connection_request_not_found`.
   */
  getAttempt(connectionRequestId: string, options?: O): Promise<ConnectionAttempt>;
  /**
   * Poll an attempt until it leaves `initiated` and return it — including the natural
   * `initiated`→`expired` flip, which does NOT throw (the user simply never finished). Throws
   * `ConnectorError` code `client_wait_timeout` only if `maxWaitMs` elapses first; an aborted
   * `signal` rejects with the standard `AbortError`.
   */
  waitForConnection(
    startOrId: string | ConnectionAttemptStart | ConnectionAttempt,
    options?: O & ConnectionWaitTuning,
  ): Promise<ConnectionAttempt>;
}

/** The request seam the owning client provides. `path` is relative to the client's base URL. */
export interface ConnectDeps<O> {
  request(method: "GET" | "POST", path: string, init: { body?: unknown; options?: O }): Promise<Envelope>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  /** The client's resolved default per-request timeout (ms); used to clamp each poll. */
  defaultTimeoutMs: number;
  /**
   * Path prefix for the connection routes: `""` for the hosted client (its base URL already ends
   * in `/v1`), `"/v1"` for the self-hosted runtime (whose base URL is the server origin).
   */
  prefix: string;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_WAIT_MS = 600_000;

/** Rename the wire `alias` to `connectionName`; preserve every other backend field. */
function toConnectedApp(data: unknown): ConnectedApp {
  const { alias, ...rest } = (data ?? {}) as Record<string, unknown>;
  return { ...rest, connectionName: (alias as string | null) ?? null } as unknown as ConnectedApp;
}

/** Drop keys the caller left undefined so a `.strict()` backend body never sees them. */
function defined(entries: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) body[key] = value;
  return body;
}

/** Build the `connect` namespace over one client's request seam. */
export function createConnectApi<O extends { signal?: AbortSignal; timeoutMs?: number }>(
  deps: ConnectDeps<O>,
): ConnectApi<O> {
  const connectPath = (service: string, mode = ""): string =>
    `${deps.prefix}/connections/${encodeURIComponent(service)}/connect${mode}`;

  const getAttempt = async (connectionRequestId: string, options?: O): Promise<ConnectionAttempt> => {
    const envelope = await deps.request(
      "GET",
      `${deps.prefix}/connection-requests/${encodeURIComponent(connectionRequestId)}`,
      { options },
    );
    return envelope.data as ConnectionAttempt;
  };

  return {
    oauth: async (service, input = {}, options) => {
      const body = defined({
        returnUri: input.returnUri,
        authorizationOptionIds: input.authorizationOptionIds,
        extra: input.extra,
        secretExtra: input.secretExtra,
      });
      const envelope = await deps.request("POST", connectPath(service), { body, options });
      return envelope.data as ConnectionAttemptStart;
    },

    apiKey: async (service, input, options) => {
      const body = defined({ apiKey: input.apiKey, extra: input.extra, comment: input.comment });
      const envelope = await deps.request("POST", connectPath(service, "/api-key"), { body, options });
      return toConnectedApp(envelope.data);
    },

    customCredential: async (service, input, options) => {
      const body = defined({ values: input.values, comment: input.comment });
      const envelope = await deps.request("POST", connectPath(service, "/custom-credential"), { body, options });
      return toConnectedApp(envelope.data);
    },

    getAttempt,

    waitForConnection: async (startOrId, options) => {
      const id = typeof startOrId === "string" ? startOrId : startOrId.connectionRequestId;
      const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const maxWaitMs = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
      const start = Date.now();
      let last: ConnectionAttempt | undefined;
      for (;;) {
        if (options?.signal?.aborted) throw abortErrorFrom(options.signal);
        // Enforce maxWaitMs as a hard wall-clock cap: never START a poll once the budget is spent...
        const remaining = maxWaitMs - (Date.now() - start);
        if (remaining <= 0) {
          throw new ConnectorError(
            `waitForConnection exceeded maxWaitMs (${maxWaitMs}ms); the authorization is still pending`,
            { code: "client_wait_timeout", status: 0, data: last },
          );
        }
        // ...and clamp THIS poll's own per-request timeout to the remaining budget, so a poll started
        // near the deadline cannot run (via its timeout + retries) past the cap.
        last = await getAttempt(id, {
          ...(options as O | undefined),
          timeoutMs: Math.min(options?.timeoutMs ?? deps.defaultTimeoutMs, remaining),
        } as O);
        // Any terminal status (connected | failed | expired) ends the wait — never throw for a user
        // who simply hasn't finished; the natural initiated→expired flip returns here too.
        if (last.status !== "initiated") return last;
        // Clamp the inter-poll sleep to the remaining budget; the loop-top check then turns a fully
        // elapsed budget into client_wait_timeout instead of sleeping or polling past the deadline.
        await deps.sleep(Math.min(pollIntervalMs, Math.max(0, maxWaitMs - (Date.now() - start))), options?.signal);
      }
    },
  };
}
