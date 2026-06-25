/**
 * `ProjectConnector` — connect third-party accounts on behalf of YOUR end-users, then act for them.
 *
 * The core `Connector` runs actions on the SDK holder's own connections. `ProjectConnector` is the
 * other side of the product: you are a platform building on OOMOL, and each of your end-users
 * (identified by an opaque `externalUserId`) links their own Gmail / Slack / GitHub / … account
 * through your app — the composio / pipedream "managed auth" model. It is a SEPARATE client,
 * constructed with a PROJECT API key (`oo_proj_…`), exposing ONLY project-scoped operations; it does
 * not carry the personal `execute` / namespace / proxy / catalog / apps surface.
 *
 * Wire-name normalization (the SDK surface speaks ONE name): the gateway request body uses `userId`
 * and its responses use `externalUserId` for the same end-user id, and `alias` for a connection's
 * name. The SDK exposes `externalUserId` and `connectionName` everywhere; the wire `userId`/`alias`
 * spellings live only inside request serialization here.
 */

import { ConnectorError } from "./errors";
import {
  abortErrorFrom,
  assertHeadersSafe,
  defaultTransport,
  send,
  type Envelope,
  type RequestSpec,
  type Transport,
} from "./http";
import type { ActionId, InputOf, OutputOf } from "./registry";
import type { RawResult } from "./types";

/**
 * Per-call options for project operations. Independent of the core `CallOptions`: a project client is
 * scoped to its project by the API key, so there is no `organization` (derived from the key) and no
 * `connectionName` default (an account is selected per call via a request-BODY field, not a header).
 */
export interface ProjectCallOptions {
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
  /** Override per-request timeout in ms. */
  timeoutMs?: number;
  /** Override retry count for this call. */
  retries?: number;
}

/**
 * Connection-request lifecycle status. `expired` is derived by the gateway at read time once an
 * `initiated` request passes its `expiresAt`. Open union (`| (string & {})`) so a new backend status
 * never breaks an exhaustive `switch` or this SDK's parsing — matching `ConnectorErrorCode`/`ActionId`.
 */
export type ConnectionRequestStatus = "initiated" | "connected" | "failed" | "expired" | (string & {});

/** Connected-account status. Open union for the same forward-compatibility reason. */
export type ConnectedAccountStatus =
  | "active"
  | "reauth_required"
  | "error"
  | "disconnected"
  | (string & {});

/**
 * A connection request — the pending/finished record of an OAuth link attempt for one end-user.
 * Returned by `connect.oauth` and re-readable via `getConnectionRequest` / `waitForConnection`.
 * Fields mirror the gateway's nullability exactly (the SDK does no local validation).
 */
export interface ConnectionRequest {
  /** Connection-request id; also the OAuth state handle. Pass to `getConnectionRequest`/`waitForConnection`. */
  id: string;
  status: ConnectionRequestStatus;
  projectId: string;
  providerConfigId: string;
  /** The end-user this request belongs to (wire response field `externalUserId`). */
  externalUserId: string;
  service: string;
  /** The connection's name (wire `alias`), or `null` when none was requested. */
  connectionName: string | null;
  /** The provider authorization URL — send your end-user here to complete OAuth. */
  authorizationUrl: string;
  /** The resulting connected-account id once the request reaches `connected`, else `null`. */
  connectedAccountId: string | null;
  /** Connector error code when `status` is `failed`, else `null`. */
  errorCode: string | null;
  errorMessage: string | null;
  /** ISO-8601 timestamp when the request expires. */
  expiresAt: string;
  /** Unix epoch milliseconds. */
  createdAt: number;
  updatedAt: number;
}

/**
 * A connected account — a stored, authorized credential for one end-user + provider. Returned
 * SYNCHRONOUSLY by `connect.apiKey` / `connect.customCredential`, and pointed to by a completed
 * OAuth `ConnectionRequest.connectedAccountId`.
 */
export interface ConnectedAccount {
  id: string;
  /** Same value as {@link id} (the gateway echoes both). */
  connectedAccountId: string;
  projectId: string;
  providerConfigId: string;
  /** The end-user this account belongs to (wire response field `externalUserId`). */
  externalUserId: string;
  /** The connection's name (wire `alias`), or `null`. Pass it back as `execute`'s `connectionName`. */
  connectionName: string | null;
  appId: string;
  status: ConnectedAccountStatus;
  /** Whether this account can currently execute actions (active + ready credential). */
  available: boolean;
  service: string | null;
  providerAccountId: string | null;
  accountLabel: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Provider selector — identify the provider config by `providerConfigId` OR by `service`.
 * The gateway enforces EXACTLY ONE (`invalid_input` otherwise). The `?: never` shape documents
 * that intent and aids autocomplete; it does not reliably reject a both-present object at compile
 * time under this project's tsconfig, so treat the gateway as the authority.
 */
export type ProviderSelector =
  | { providerConfigId: string; service?: never }
  | { service: string; providerConfigId?: never };

/** Input for `connect.oauth`. */
export type OAuthConnectInput = ProviderSelector & {
  /** Name to assign the connection; pass it back later as `execute`'s `connectionName`. Auto-generated if omitted. */
  connectionName?: string;
  /** Optional URL the gateway returns the user to after the OAuth callback completes. */
  returnUri?: string;
};

/** Input for `connect.apiKey`. */
export type ApiKeyConnectInput = ProviderSelector & {
  /** The END-USER's upstream provider API key (e.g. an `sk-…`). NEVER the gateway `oo_proj_` auth key. */
  apiKey: string;
  /** Name to assign the connection; pass it back later as `execute`'s `connectionName`. Auto-generated if omitted. */
  connectionName?: string;
  /** Provider-specific extra fields validated against the provider config (e.g. `{ region }`). */
  extra?: Record<string, string>;
};

/** Input for `connect.customCredential`. */
export type CustomCredentialConnectInput = ProviderSelector & {
  /** Provider credential field values, validated by the gateway against the provider config. */
  values: Record<string, string>;
  /** Name to assign the connection; pass it back later as `execute`'s `connectionName`. Auto-generated if omitted. */
  connectionName?: string;
};

/**
 * Options for `execute` / `executeRaw`. Provider selection is genuinely OPTIONAL: when neither
 * `providerConfigId` nor `service` is given, the SDK derives `service` from the actionId prefix
 * (`gmail.search_threads` → `gmail`). Resolution precedence (the gateway rejects more than one of
 * each pair): `providerConfigId` wins over `service` (and suppresses the derived service);
 * `connectedAccountId` wins over `connectionName`. With no account selector the gateway uses the
 * end-user's latest active account for that provider.
 */
export interface ProjectExecuteOptions extends ProjectCallOptions {
  /** Pick the provider config explicitly (multi-config projects). Overrides `service` + actionId derivation. */
  providerConfigId?: string;
  /** Override the provider service (defaults to the actionId prefix). Mismatching the prefix is a gateway error. */
  service?: string;
  /** Target a specific connected account by id. */
  connectedAccountId?: string;
  /** Target a connected account by its name (wire `alias`). Ignored if `connectedAccountId` is set. */
  connectionName?: string;
}

/**
 * Tuning for `waitForConnection`. `maxWaitMs` is the total wall-clock cap — the one you usually
 * want. `timeoutMs` (inherited) is the advanced PER-POLL HTTP timeout, rarely tuned. `signal`
 * aborts the whole wait and is forwarded to each poll's fetch.
 */
export interface WaitForConnectionOptions extends ProjectCallOptions {
  /** Delay between status polls. Default 2000ms. */
  pollIntervalMs?: number;
  /** Overall cap on how long to wait for the user to finish. Default 600_000ms (matches request expiry). */
  maxWaitMs?: number;
}

/** Connect an account for an explicit end-user (`externalUserId` first). */
interface ProjectConnectApi {
  /**
   * Start an OAuth link. Returns a PENDING {@link ConnectionRequest} — send your user to
   * `.authorizationUrl`, then `await project.waitForConnection(request)` for completion.
   */
  oauth(externalUserId: string, input: OAuthConnectInput, options?: ProjectCallOptions): Promise<ConnectionRequest>;
  /** Connect by API key. SYNCHRONOUS — returns a ready {@link ConnectedAccount}; no waiting needed. */
  apiKey(externalUserId: string, input: ApiKeyConnectInput, options?: ProjectCallOptions): Promise<ConnectedAccount>;
  /** Connect by custom credential values. SYNCHRONOUS — returns a ready {@link ConnectedAccount}; no waiting needed. */
  customCredential(
    externalUserId: string,
    input: CustomCredentialConnectInput,
    options?: ProjectCallOptions,
  ): Promise<ConnectedAccount>;
}

/** Connect an account for the end-user already bound by `forUser`. */
interface ProjectUserConnectApi {
  /** See {@link ProjectConnectApi.oauth}; the end-user is bound by `forUser`. */
  oauth(input: OAuthConnectInput, options?: ProjectCallOptions): Promise<ConnectionRequest>;
  /** See {@link ProjectConnectApi.apiKey}; the end-user is bound by `forUser`. */
  apiKey(input: ApiKeyConnectInput, options?: ProjectCallOptions): Promise<ConnectedAccount>;
  /** See {@link ProjectConnectApi.customCredential}; the end-user is bound by `forUser`. */
  customCredential(input: CustomCredentialConnectInput, options?: ProjectCallOptions): Promise<ConnectedAccount>;
}

/** The project-scoped surface — the shape of a {@link ProjectConnector} instance. */
export interface ProjectApi {
  readonly connect: ProjectConnectApi;
  /**
   * Read a connection request by the `id` returned from a `connect.*` call (`data.id`). This is the
   * OAuth flow's status handle — pair it with `waitForConnection` to poll an OAuth link to completion.
   * `connect.apiKey` / `connect.customCredential` already return a ready `ConnectedAccount`, so you
   * normally don't poll those. Unknown ids reject with `connection_request_not_found`.
   */
  getConnectionRequest(connectionRequestId: string, options?: ProjectCallOptions): Promise<ConnectionRequest>;
  /**
   * Poll a connection request until it leaves `initiated` and return it (including the gateway's
   * natural `initiated`→`expired` flip near expiry — a stalled OAuth flow does NOT throw). Throws
   * `ConnectorError` code `client_wait_timeout` only if `maxWaitMs` elapses first; an aborted
   * `signal` rejects with the standard `AbortError`.
   */
  waitForConnection(
    requestOrId: string | ConnectionRequest,
    options?: WaitForConnectionOptions,
  ): Promise<ConnectionRequest>;
  /** Execute an action on behalf of an end-user. Returns the action output directly. */
  execute<A extends ActionId>(
    externalUserId: string,
    actionId: A,
    input: InputOf<A>,
    options?: ProjectExecuteOptions,
  ): Promise<OutputOf<A>>;
  /** Like `execute`, but returns `{ data, executionId, actionId, message }`. */
  executeRaw<A extends ActionId>(
    externalUserId: string,
    actionId: A,
    input: InputOf<A>,
    options?: ProjectExecuteOptions,
  ): Promise<RawResult<OutputOf<A>>>;
  /** Bind an end-user once and drop the repeated `externalUserId` from every call. */
  forUser(externalUserId: string): ProjectUser;
}

/** A project sub-client bound to one end-user (returned by {@link ProjectApi.forUser}). */
export interface ProjectUser {
  /** The end-user this sub-client is bound to. */
  readonly externalUserId: string;
  /** Connect an account for this user — see {@link ProjectApi.connect}. */
  readonly connect: ProjectUserConnectApi;
  /** See {@link ProjectApi.getConnectionRequest}. */
  getConnectionRequest(connectionRequestId: string, options?: ProjectCallOptions): Promise<ConnectionRequest>;
  /** See {@link ProjectApi.waitForConnection}. */
  waitForConnection(
    requestOrId: string | ConnectionRequest,
    options?: WaitForConnectionOptions,
  ): Promise<ConnectionRequest>;
  /** Execute an action on this user's behalf — see {@link ProjectApi.execute}. */
  execute<A extends ActionId>(actionId: A, input: InputOf<A>, options?: ProjectExecuteOptions): Promise<OutputOf<A>>;
  /** Like {@link ProjectUser.execute}, but returns `{ data, executionId, actionId, message }`. */
  executeRaw<A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options?: ProjectExecuteOptions,
  ): Promise<RawResult<OutputOf<A>>>;
}

/**
 * Internal seam between the {@link ProjectConnector} class and the surface factory. `request` builds
 * + sends a project request (project-key auth) and returns the parsed envelope; `sleep` paces
 * `waitForConnection` (injectable so tests need not actually wait).
 */
interface ProjectTransport {
  request(
    method: "GET" | "POST",
    path: string,
    init: { body?: unknown; options?: ProjectCallOptions; actionId?: string },
  ): Promise<Envelope>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_WAIT_MS = 600_000;

/** Rename the wire `alias` to `connectionName`; preserve every other gateway field. */
function toConnectionRequest(data: unknown): ConnectionRequest {
  const { alias, ...rest } = (data ?? {}) as Record<string, unknown>;
  return { ...rest, connectionName: (alias as string | null) ?? null } as unknown as ConnectionRequest;
}

function toConnectedAccount(data: unknown): ConnectedAccount {
  const { alias, ...rest } = (data ?? {}) as Record<string, unknown>;
  return { ...rest, connectionName: (alias as string | null) ?? null } as unknown as ConnectedAccount;
}

/** Map the provider selector to its single wire key (`providerConfigId` preferred). Guard on
 * presence, not truthiness, so a caller-supplied value is forwarded as-is for the gateway to judge. */
function providerKeys(sel: { providerConfigId?: string; service?: string }): Record<string, string> {
  if (sel.providerConfigId !== undefined) return { providerConfigId: sel.providerConfigId };
  if (sel.service !== undefined) return { service: sel.service };
  return {};
}

/** Emit the wire `alias` field only when a connectionName was provided (so the gateway can default it). */
function aliasField(connectionName: string | undefined): Record<string, string> {
  return connectionName === undefined ? {} : { alias: connectionName };
}

/** Build the project surface over the request/sleep seam. */
function createProjectApi(deps: ProjectTransport): ProjectApi {
  const connect: ProjectConnectApi = {
    oauth: async (externalUserId, input, options) => {
      const body = {
        userId: externalUserId,
        ...providerKeys(input),
        ...aliasField(input.connectionName),
        ...(input.returnUri === undefined ? {} : { returnUri: input.returnUri }),
      };
      const envelope = await deps.request("POST", "/saas/connected-accounts/link", { body, options });
      return toConnectionRequest(envelope.data);
    },
    apiKey: async (externalUserId, input, options) => {
      const body = {
        userId: externalUserId,
        ...providerKeys(input),
        ...aliasField(input.connectionName),
        apiKey: input.apiKey,
        ...(input.extra === undefined ? {} : { extra: input.extra }),
      };
      const envelope = await deps.request("POST", "/saas/connected-accounts/api-key", { body, options });
      return toConnectedAccount(envelope.data);
    },
    customCredential: async (externalUserId, input, options) => {
      const body = {
        userId: externalUserId,
        ...providerKeys(input),
        ...aliasField(input.connectionName),
        values: input.values,
      };
      const envelope = await deps.request("POST", "/saas/connected-accounts/custom-credential", { body, options });
      return toConnectedAccount(envelope.data);
    },
  };

  const getConnectionRequest = async (
    connectionRequestId: string,
    options?: ProjectCallOptions,
  ): Promise<ConnectionRequest> => {
    const envelope = await deps.request(
      "GET",
      `/saas/connection-requests/${encodeURIComponent(connectionRequestId)}`,
      { options },
    );
    return toConnectionRequest(envelope.data);
  };

  const waitForConnection = async (
    requestOrId: string | ConnectionRequest,
    options: WaitForConnectionOptions = {},
  ): Promise<ConnectionRequest> => {
    const id = typeof requestOrId === "string" ? requestOrId : requestOrId.id;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    const start = Date.now();
    for (;;) {
      if (options.signal?.aborted) throw abortErrorFrom(options.signal);
      // Forward the request-shaped options (signal/timeoutMs/retries) to every poll so polling stays
      // auth-consistent. WaitForConnectionOptions extends ProjectCallOptions and the request seam
      // ignores the extra pollIntervalMs/maxWaitMs keys, so `options` flows straight through and can
      // never fall out of sync with a hand-copied field list.
      const request = await getConnectionRequest(id, options);
      // Any terminal status (connected | failed | expired) ends the wait — never throw for a user who
      // simply hasn't finished; the natural initiated→expired flip returns here too.
      if (request.status !== "initiated") return request;
      // Enforce maxWaitMs as a hard cap: stop BEFORE waiting/polling past it, and clamp the final
      // sleep to the remaining budget so the next poll fires no later than the deadline (rather than
      // a full pollIntervalMs past it, then wasting one more request).
      const remaining = maxWaitMs - (Date.now() - start);
      if (remaining <= 0) {
        throw new ConnectorError(
          `waitForConnection exceeded maxWaitMs (${maxWaitMs}ms); connection request is still pending`,
          { code: "client_wait_timeout", status: 0, data: request },
        );
      }
      await deps.sleep(Math.min(pollIntervalMs, remaining), options.signal);
    }
  };

  const executeRaw = async <A extends ActionId>(
    externalUserId: string,
    actionId: A,
    input: InputOf<A>,
    options: ProjectExecuteOptions = {},
  ): Promise<RawResult<OutputOf<A>>> => {
    // Provider key: explicit providerConfigId > explicit service > service derived from the actionId
    // prefix. Exactly one reaches the body — never a derived service alongside a supplied providerConfigId.
    const provider: Record<string, string> =
      options.providerConfigId !== undefined
        ? { providerConfigId: options.providerConfigId }
        : { service: options.service ?? actionId.split(".")[0] };
    // Account selector: connectedAccountId > connectionName (wire `alias`); omit both for latest-active.
    const account: Record<string, string> =
      options.connectedAccountId !== undefined
        ? { connectedAccountId: options.connectedAccountId }
        : aliasField(options.connectionName);
    const body = { userId: externalUserId, ...provider, ...account, input };
    const id = String(actionId);
    const envelope = await deps.request("POST", `/saas/actions/${encodeURIComponent(id)}`, {
      body,
      options,
      actionId: id,
    });
    // The execute envelope nests its metadata INSIDE `data` ({ executionId, actionId, output }),
    // unlike the core action envelope which puts them in `meta`. Surface the action output as `data`.
    const result = (envelope.data ?? {}) as { executionId?: string; actionId?: string; output?: unknown };
    return {
      data: result.output as OutputOf<A>,
      executionId: result.executionId,
      actionId: result.actionId ?? id,
      message: envelope.message,
    };
  };

  const execute = async <A extends ActionId>(
    externalUserId: string,
    actionId: A,
    input: InputOf<A>,
    options?: ProjectExecuteOptions,
  ): Promise<OutputOf<A>> => (await executeRaw(externalUserId, actionId, input, options)).data;

  const forUser = (externalUserId: string): ProjectUser => ({
    externalUserId,
    connect: {
      oauth: (input, options) => connect.oauth(externalUserId, input, options),
      apiKey: (input, options) => connect.apiKey(externalUserId, input, options),
      customCredential: (input, options) => connect.customCredential(externalUserId, input, options),
    },
    getConnectionRequest,
    waitForConnection,
    execute: <A extends ActionId>(actionId: A, input: InputOf<A>, options?: ProjectExecuteOptions) =>
      execute(externalUserId, actionId, input, options),
    executeRaw: <A extends ActionId>(actionId: A, input: InputOf<A>, options?: ProjectExecuteOptions) =>
      executeRaw(externalUserId, actionId, input, options),
  });

  return { connect, getConnectionRequest, waitForConnection, execute, executeRaw, forUser };
}

declare const __PKG_VERSION__: string;
const USER_AGENT = `@oomol-lab/connector/${__PKG_VERSION__}`;
const DEFAULT_BASE_URL = "https://connector.oomol.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/** Construction config for {@link ProjectConnector}. */
export interface ProjectConnectorConfig {
  /** Project API key (shaped like `oo_proj_…`). Sent as `Authorization: Bearer <apiKey>`. Required. */
  apiKey: string;
  /** Gateway base URL. Defaults to production `https://connector.oomol.com/v1`. */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Max retries for 429 / 5xx / network errors (exponential backoff + jitter). Default 2. */
  maxRetries?: number;
  /** Injectable fetch for testing / custom agents. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

interface ResolvedProjectConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

/** Assemble one project request: project-key auth + standard headers (NO org / connector-alias). */
function buildProjectSpec(
  cfg: ResolvedProjectConfig,
  method: "GET" | "POST",
  path: string,
  init: { body?: unknown; options?: ProjectCallOptions; actionId?: string },
): RequestSpec {
  const headers: Record<string, string> = {
    authorization: `Bearer ${cfg.apiKey}`,
    "user-agent": USER_AGENT,
    accept: "application/json",
  };
  if (init.body !== undefined) headers["content-type"] = "application/json";
  assertHeadersSafe(headers);
  const options = init.options;
  return {
    method,
    url: cfg.baseUrl + path,
    headers,
    body: init.body,
    retries: options?.retries ?? cfg.maxRetries,
    timeoutMs: options?.timeoutMs ?? cfg.timeoutMs,
    signal: options?.signal,
    actionId: init.actionId,
  };
}

// The constructor RETURNS the project surface (factory idiom, mirroring `Connector`), so the class
// has only a constructor — a class is still needed for the `new ProjectConnector(...)` call shape.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class ProjectConnectorImpl {
  // The third `transport` arg is internal (test injection); the public type omits it.
  constructor(config: ProjectConnectorConfig, transport?: Transport) {
    if (!config || typeof config.apiKey !== "string" || config.apiKey.length === 0) {
      throw new ConnectorError("`apiKey` is required", { code: "client_invalid_request", status: 0 });
    }
    const cfg: ResolvedProjectConfig = {
      apiKey: config.apiKey,
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
    const t = transport ?? (config.fetch ? { ...defaultTransport, fetch: config.fetch } : defaultTransport);
    // The constructor RETURNS the project surface, so `new ProjectConnector(...)` IS the api.
    return createProjectApi({
      request: (method, path, init) => send(buildProjectSpec(cfg, method, path, init), t),
      sleep: (ms, signal) => t.sleep(ms, signal),
    }) as unknown as ProjectConnectorImpl;
  }
}

/**
 * The project-scoped client — construct with a project API key (`oo_proj_…`) to connect accounts for
 * your end-users and run actions on their behalf. Fully separate from the personal {@link Connector}.
 */
export const ProjectConnector = ProjectConnectorImpl as unknown as {
  new (config: ProjectConnectorConfig): ProjectConnector;
};
/** A {@link ProjectConnector} instance — the project-scoped surface. */
export type ProjectConnector = ProjectApi;
