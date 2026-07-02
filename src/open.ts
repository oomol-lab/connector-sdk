/**
 * `OpenConnector` — the personal client for the open-source, self-hosted Connector runtime.
 *
 * The open-source backend is the self-hostable counterpart of the PERSONAL product: one user, one
 * server, running actions on that user's own connections. `OpenConnector` therefore mirrors the
 * core `Connector` surface — `execute` / `executeRaw` (path 1), the `open.<service>.<action>(...)`
 * namespace sugar (path 2, same two-layer Proxy), `catalog`, `apps` — plus the runtime's own
 * `health` probe and catalog extras (`search`, `services`, per-service apps).
 *
 * What it deliberately does NOT cover: the runtime's management API (creating connections, OAuth
 * client configs, minting tokens, run logs). Those are server administration, owned by the
 * runtime's web console — not by this SDK layer.
 *
 * Auth is a single OPTIONAL runtime token (`oct_…`, minted in the runtime's web console): a fresh
 * instance answers without any token, and once tokens exist the server enforces them. There is no
 * `oo_…` API key and no organization here — the server is yours.
 *
 * Wire-name normalization: `/v1/apps*` responses spell the connection name `alias`; the SDK
 * surface speaks `connectionName` everywhere, matching the core `Connector`.
 */

import { ConnectorError } from "./errors";
import {
  assertHeadersSafe,
  defaultTransport,
  send,
  type Envelope,
  type RequestSpec,
  type Transport,
} from "./http";
import type { ActionId, InputOf, OutputOf, ServiceNamespaces } from "./registry";
import type { ConnectedApp, ProviderMetadata, ProviderQuery, RawResult } from "./types";

/**
 * Per-call options for open-runtime operations. No `organization` (the runtime is single-user);
 * the connection selector rides on {@link OpenExecuteOptions.connectionName}.
 */
export interface OpenCallOptions {
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
  /** Override per-request timeout in ms. */
  timeoutMs?: number;
  /** Override retry count for this call. */
  retries?: number;
}

/** Options for `execute` / `executeRaw`. */
export interface OpenExecuteOptions extends OpenCallOptions {
  /** Target a named connection (wire header `x-oo-connector-alias`). Default: the client-level `connectionName`, else the runtime's `"default"`. */
  connectionName?: string;
}

/** `GET /v1/health` payload — also a cheap connectivity/auth probe. */
export interface OpenHealth {
  ok: boolean;
  /** Runtime identifier (the open-source backend reports `"oomol-connect"`). */
  runtime: string;
}

/** A follow-up pointer on an action. The runtime wire shape is `{ actionId }` wrappers, NOT bare id strings. */
export interface OpenActionFollowUp {
  actionId: string;
}

/** Action ids modeling a start/status/cancel async workflow. */
export interface OpenActionAsyncLifecycle {
  startActionId: string;
  statusActionId: string;
  cancelActionId?: string;
}

/**
 * Single action metadata (`GET /v1/actions/{actionId}`). The runtime's own shape — richer and
 * stricter than the hosted `ActionMetadata` (every field present; `followUpActions` are
 * `{ actionId }` wrappers; `asyncLifecycle` is `null` when absent).
 */
export interface OpenActionMetadata {
  id: string;
  service: string;
  name: string;
  description: string;
  requiredScopes: string[];
  providerPermissions: string[];
  /** JSON Schema (2020-12) for the action input. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema (2020-12) for the action output. */
  outputSchema: Record<string, unknown>;
  followUpActions: OpenActionFollowUp[];
  asyncLifecycle: OpenActionAsyncLifecycle | null;
}

/** One `/v1/actions/search` hit — action metadata trimmed to what ranking returns. */
export interface OpenActionSearchResult {
  id: string;
  service: string;
  name: string;
  description: string;
  /** JSON Schema (2020-12) for the action input. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema (2020-12) for the action output. */
  outputSchema: Record<string, unknown>;
}

/** Server-side filter for `catalog.search`. */
export interface OpenSearchQuery {
  /** Restrict hits to one provider service. */
  service?: string;
  /** Max hits, 1–50. Default 10 (server-side). */
  limit?: number;
}

/** Catalog / metadata introspection. */
export interface OpenCatalogApi {
  /** `GET /v1/actions/{actionId}` — full metadata for one action (404 ⇒ unknown action). */
  action(actionId: string, options?: OpenCallOptions): Promise<OpenActionMetadata>;
  /** `GET /v1/actions?service=X` — all actions of a service. */
  actions(service: string, options?: OpenCallOptions): Promise<OpenActionMetadata[]>;
  /** `GET /v1/actions` (no service) — every service id that has actions. */
  services(options?: OpenCallOptions): Promise<string[]>;
  /** `GET /v1/providers` — list providers, optionally narrowed by service id(s) / search query. */
  providers(query?: ProviderQuery, options?: OpenCallOptions): Promise<ProviderMetadata[]>;
  /** `GET /v1/actions/search?q=…` — rank actions by free-text relevance. */
  search(q: string, query?: OpenSearchQuery, options?: OpenCallOptions): Promise<OpenActionSearchResult[]>;
}

/** Connected-app introspection (read-only). */
export interface OpenAppsApi {
  /** `GET /v1/apps` — every connection the runtime can execute with. */
  list(options?: OpenCallOptions): Promise<ConnectedApp[]>;
  /** `GET /v1/apps/services/{service}` — one service's connections (404 ⇒ unknown service). */
  listByService(service: string, options?: OpenCallOptions): Promise<ConnectedApp[]>;
  /** `GET /v1/apps/authenticated` — which of the given services have a REAL credential stored (no-auth virtual connections don't count). */
  authenticated(services: string[], options?: OpenCallOptions): Promise<string[]>;
}

/**
 * Methods of the open-runtime surface (path 1 + introspection). The full {@link OpenConnector}
 * type also carries the path-2 service namespaces.
 */
export interface OpenConnectorApi {
  /** Execute an action on the runtime's own connections. Returns the action output directly. */
  execute<A extends ActionId>(actionId: A, input: InputOf<A>, options?: OpenExecuteOptions): Promise<OutputOf<A>>;
  /** Like `execute`, but returns `{ data, executionId, actionId, message }`. */
  executeRaw<A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options?: OpenExecuteOptions,
  ): Promise<RawResult<OutputOf<A>>>;
  /** `GET /v1/health` — connectivity/auth probe. */
  health(options?: OpenCallOptions): Promise<OpenHealth>;
  /** Catalog / metadata introspection. */
  readonly catalog: OpenCatalogApi;
  /** Connected-app introspection (read-only). */
  readonly apps: OpenAppsApi;
}

/**
 * Top-level members that are NOT treated as service namespaces. A provider whose service id
 * collides with one of these is still fully callable via `execute` — only its path-2 sugar is
 * shadowed (the same caveat the core `Connector` carries for its reserved names).
 */
const RESERVED = new Set<string>(["execute", "executeRaw", "health", "catalog", "apps"]);

/**
 * Build the second-layer Proxy for a service. Each property access returns a caller that
 * forwards to `execute`. Returns `undefined` for thenable keys and any symbol so
 * `await open.<service>` never hangs (the thenable trap).
 */
function makeServiceProxy(api: OpenConnectorApi, service: string): unknown {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      const action = `${service}.${prop}`;
      return (input?: unknown, options?: OpenExecuteOptions) =>
        api.execute(action as ActionId, input as never, options);
    },
  });
}

/**
 * Wrap the plain surface in the top-level Proxy that resolves any non-member property to a
 * service namespace, enabling `open.<service>.<action>(...)`.
 */
function withServiceNamespaces(api: OpenConnectorApi): OpenConnectorApi {
  return new Proxy(api, {
    get(target, prop) {
      if (typeof prop === "symbol") return Reflect.get(target, prop, target);
      // Defense in depth: never let the top-level object be treated as thenable.
      if (prop === "then") return undefined;
      if (RESERVED.has(prop) || prop in target) return Reflect.get(target, prop, target);
      // Otherwise: a service namespace.
      return makeServiceProxy(target, prop);
    },
  });
}

/**
 * Internal seam between the {@link OpenConnector} class and the surface factory. `request` builds
 * + sends one runtime request and returns the parsed envelope.
 */
interface OpenTransport {
  request(
    method: RequestSpec["method"],
    path: string,
    init: {
      body?: unknown;
      query?: Record<string, string | string[] | undefined>;
      options?: OpenCallOptions;
      actionId?: string;
      /** Connection selector for execute calls (wire header `x-oo-connector-alias`). */
      connectionName?: string;
    },
  ): Promise<Envelope>;
  /** Client-level default connection name (from config), if any. */
  defaultConnectionName?: string;
}

/** Rename the wire `alias` to `connectionName`; preserve every other runtime field. */
function toConnectedApps(data: unknown): ConnectedApp[] {
  const raw = (data ?? []) as Array<Record<string, unknown>>;
  return raw.map(({ alias, ...rest }) => ({ ...rest, connectionName: alias ?? null })) as ConnectedApp[];
}

/** Build the open-runtime surface over the request seam. */
function createOpenApi(deps: OpenTransport): OpenConnectorApi {
  const executeRaw = async <A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options: OpenExecuteOptions = {},
  ): Promise<RawResult<OutputOf<A>>> => {
    const id = String(actionId);
    const envelope = await deps.request("POST", `/v1/actions/${encodeURIComponent(id)}`, {
      body: { input },
      options,
      actionId: id,
      connectionName: options.connectionName ?? deps.defaultConnectionName,
    });
    return {
      data: envelope.data as OutputOf<A>,
      executionId: envelope.meta?.executionId,
      actionId: envelope.meta?.actionId ?? id,
      message: envelope.message,
    };
  };

  const execute = async <A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options?: OpenExecuteOptions,
  ): Promise<OutputOf<A>> => (await executeRaw(actionId, input, options)).data;

  const health = async (options?: OpenCallOptions): Promise<OpenHealth> => {
    const envelope = await deps.request("GET", "/v1/health", { options });
    return envelope.data as OpenHealth;
  };

  const catalog: OpenCatalogApi = {
    action: async (actionId, options) => {
      const envelope = await deps.request("GET", `/v1/actions/${encodeURIComponent(actionId)}`, {
        options,
        actionId,
      });
      return envelope.data as OpenActionMetadata;
    },
    actions: async (service, options) => {
      const envelope = await deps.request("GET", "/v1/actions", { query: { service }, options });
      return envelope.data as OpenActionMetadata[];
    },
    services: async (options) => {
      // Without ?service= the runtime returns service WRAPPERS ([{ service }]); flatten to ids.
      const envelope = await deps.request("GET", "/v1/actions", { options });
      return ((envelope.data ?? []) as Array<{ service: string }>).map((entry) => entry.service);
    },
    providers: async (query, options) => {
      const envelope = await deps.request("GET", "/v1/providers", {
        query: { service: query?.service, q: query?.q },
        options,
      });
      return envelope.data as ProviderMetadata[];
    },
    search: async (q, query, options) => {
      const envelope = await deps.request("GET", "/v1/actions/search", {
        query: { q, service: query?.service, limit: query?.limit === undefined ? undefined : String(query.limit) },
        options,
      });
      return envelope.data as OpenActionSearchResult[];
    },
  };

  const apps: OpenAppsApi = {
    list: async (options) => {
      const envelope = await deps.request("GET", "/v1/apps", { options });
      return toConnectedApps(envelope.data);
    },
    listByService: async (service, options) => {
      const envelope = await deps.request("GET", `/v1/apps/services/${encodeURIComponent(service)}`, { options });
      return toConnectedApps(envelope.data);
    },
    authenticated: async (services, options) => {
      const envelope = await deps.request("GET", "/v1/apps/authenticated", {
        query: { service: services },
        options,
      });
      return envelope.data as string[];
    },
  };

  // The sub-panels are frozen here; the constructor freezes the top level (after installing the
  // class prototype) so a stray assignment (`open.catalog = …`) throws instead of silently
  // replacing an API panel — matching how the hosted client's getter-only accessors reject it.
  return { execute, executeRaw, health, catalog: Object.freeze(catalog), apps: Object.freeze(apps) };
}

declare const __PKG_VERSION__: string;
const USER_AGENT = `@oomol-lab/connector/${__PKG_VERSION__}`;
const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/** Construction config for {@link OpenConnector}. Every field is optional — a fresh runtime needs no auth. */
export interface OpenConnectorConfig {
  /**
   * The runtime server ORIGIN (e.g. `http://localhost:3000` or wherever you deployed it) — NOT a
   * `/v1` url; the client adds the path prefix itself. Defaults to `http://localhost:3000`.
   */
  baseUrl?: string;
  /**
   * Runtime token (`oct_…`, minted in the runtime's web console), sent as
   * `Authorization: Bearer <runtimeToken>`. Optional: a runtime with no tokens answers openly.
   */
  runtimeToken?: string;
  /** Client-level default connection name, applied to `execute` calls (per-call option wins). */
  connectionName?: string;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Max retries for 429 / 5xx / network errors (exponential backoff + jitter). Default 2. */
  maxRetries?: number;
  /** Injectable fetch for testing / custom agents. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

interface ResolvedOpenConfig {
  baseUrl: string;
  runtimeToken?: string;
  connectionName?: string;
  timeoutMs: number;
  maxRetries: number;
}

/** Assemble one runtime request: optional bearer + standard headers + query string. */
function buildOpenSpec(
  cfg: ResolvedOpenConfig,
  method: RequestSpec["method"],
  path: string,
  init: {
    body?: unknown;
    query?: Record<string, string | string[] | undefined>;
    options?: OpenCallOptions;
    actionId?: string;
    connectionName?: string;
  },
): RequestSpec {
  const url = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
    else url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: "application/json",
  };
  // A tokenless request is a first-class mode (fresh instance, auth not enabled) — the server is
  // the authority on whether that suffices, so no header is sent rather than an empty one.
  if (cfg.runtimeToken !== undefined) headers["authorization"] = `Bearer ${cfg.runtimeToken}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  // Connection name selector — carried as the client header the runtime reads (wire key stays `alias`).
  if (init.connectionName !== undefined) headers["x-oo-connector-alias"] = init.connectionName;
  assertHeadersSafe(headers);

  const options = init.options;
  return {
    method,
    url: url.toString(),
    headers,
    body: init.body,
    retries: options?.retries ?? cfg.maxRetries,
    timeoutMs: options?.timeoutMs ?? cfg.timeoutMs,
    signal: options?.signal,
    actionId: init.actionId,
  };
}

// The constructor RETURNS the open-runtime surface (factory idiom, mirroring `ProjectConnector`),
// so the class has only a constructor — a class is still needed for the `new OpenConnector(...)`
// call shape.
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class OpenConnectorImpl {
  // The second `transport` arg is internal (test injection); the public type omits it.
  constructor(config: OpenConnectorConfig = {}, transport?: Transport) {
    // Reject a provided-but-empty (or non-string) token up front — it could only ever fail auth
    // confusingly. Absent is fine: tokenless is how a fresh runtime runs.
    if (config.runtimeToken !== undefined && (typeof config.runtimeToken !== "string" || config.runtimeToken.length === 0)) {
      throw new ConnectorError("`runtimeToken` must be a non-empty string when provided", {
        code: "client_invalid_request",
        status: 0,
      });
    }
    const cfg: ResolvedOpenConfig = {
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      runtimeToken: config.runtimeToken,
      connectionName: config.connectionName,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
    const t = transport ?? (config.fetch ? { ...defaultTransport, fetch: config.fetch } : defaultTransport);
    const api = createOpenApi({
      request: (method, path, init) => send(buildOpenSpec(cfg, method, path, init), t),
      defaultConnectionName: cfg.connectionName,
    });
    // Install the class prototype (so `open instanceof OpenConnector`, `constructor.name`, and
    // inspection match the hosted client — the factory would otherwise leave a plain object),
    // THEN freeze: assignment to any member throws rather than silently replacing an API panel.
    Object.setPrototypeOf(api, OpenConnectorImpl.prototype);
    Object.freeze(api);
    // The constructor RETURNS the runtime surface (wrapped in the namespace Proxy), so
    // `new OpenConnector(...)` IS the api and `open.<service>.<action>(...)` resolves at runtime.
    return withServiceNamespaces(api) as unknown as OpenConnectorImpl;
  }
}

/**
 * The open-source runtime client — point it at the self-hosted Connector server you run and use
 * it like the personal {@link Connector}: execute actions (both `open.execute(...)` and
 * `open.<service>.<action>(...)`), browse the catalog, inspect connected apps. Connections and
 * credentials are managed in the runtime's web console, not here.
 */
export const OpenConnector = OpenConnectorImpl as unknown as {
  new (config?: OpenConnectorConfig): OpenConnector;
};
/**
 * An {@link OpenConnector} instance: methods + (precise/loose) service namespaces. The namespaces
 * carry this client's own per-call options (no `organization` — the runtime is single-user).
 * A service id colliding with a member name (`execute` / `executeRaw` / `health` / `catalog` /
 * `apps`) loses only its path-2 sugar — call it via `execute("<service>.<action>", …)`.
 */
export type OpenConnector = OpenConnectorApi & ServiceNamespaces<OpenExecuteOptions>;
