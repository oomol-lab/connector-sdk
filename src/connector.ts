/**
 * Connector — the core runtime client.
 *
 * The exported `Connector` is a merged type + value: the type is
 * `ConnectorMethods & ServiceNamespaces` (so registered services get precise namespaces),
 * and the value is a constructor whose instances are a two-layer `Proxy` (so
 * `oomol.<service>.<action>(...)` resolves at runtime to `execute("<service>.<action>", ...)`).
 */

import { ConnectorError } from "./errors";
import { assertHeadersSafe, defaultTransport, send, type RequestSpec, type Transport } from "./http";
import type {
  ActionId,
  InputOf,
  OutputOf,
  ServiceNamespaces,
} from "./registry";
import type {
  ActionMetadata,
  AppsApi,
  CallOptions,
  CatalogApi,
  ClientConfig,
  ConnectedApp,
  ProviderMetadata,
  ProviderQuery,
  ProxyRequest,
  ProxyResponse,
  RawResult,
  ScopeOptions,
} from "./types";

declare const __PKG_VERSION__: string;
const VERSION = __PKG_VERSION__;
const USER_AGENT = `@oomol-lab/connector/${VERSION}`;

const DEFAULT_BASE_URL = "https://connector.oomol.com/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/** Reserved top-level members that are NOT treated as service namespaces. */
const RESERVED = new Set<string>([
  "execute",
  "executeRaw",
  "using",
  "proxy",
  "catalog",
  "apps",
]);

/** Methods of the typed Connector surface (path 1 + introspection). */
export interface ConnectorMethods {
  /** Path 1 — dynamic string entry point. Always callable; precise for registered actions. */
  execute<A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options?: CallOptions,
  ): Promise<OutputOf<A>>;
  /** Like `execute`, but returns `{ data, executionId, actionId, message }`. */
  executeRaw<A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options?: CallOptions,
  ): Promise<RawResult<OutputOf<A>>>;
  /** Immutable scoped sub-client that merges the given defaults. */
  using(scope: ScopeOptions): Connector;
  /** `POST /v1/proxy/{service}` passthrough. */
  proxy<T = unknown>(
    service: string,
    req: ProxyRequest,
    options?: CallOptions,
  ): Promise<ProxyResponse<T>>;
  /** Catalog / metadata introspection. */
  readonly catalog: CatalogApi;
  /** Connection introspection (read-only). */
  readonly apps: AppsApi;
}

/**
 * The public Connector type: methods + (precise/loose) service namespaces. A service id colliding
 * with a reserved member (`execute` / `executeRaw` / `using` / `proxy` / `catalog` / `apps`)
 * loses only its path-2 sugar — call it via `execute("<service>.<action>", …)`.
 */
export type Connector = ConnectorMethods & ServiceNamespaces;

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string;
  organization?: string;
  connectionName?: string;
  timeoutMs: number;
  maxRetries: number;
}

/** Internal merged defaults applied per call (from `using()` scope). */
interface ScopeDefaults {
  organization?: string;
  connectionName?: string;
}

/**
 * Build the second-layer Proxy for a service. Each property access returns a caller
 * that forwards to `execute`. Returns `undefined` for thenable keys and any symbol so
 * `await oomol.<service>` never hangs (the thenable trap).
 */
function makeServiceProxy(self: ConnectorImpl, service: string): unknown {
  return new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop === "symbol") return undefined;
      if (prop === "then" || prop === "catch" || prop === "finally") return undefined;
      const action = `${service}.${prop}`;
      return (input?: unknown, options?: CallOptions) => self.execute(action as ActionId, input as never, options);
    },
  });
}

class ConnectorImpl implements ConnectorMethods {
  // Index signature so the top-level Proxy's service-namespace access type-checks
  // against the implementation. The Proxy supplies the actual values.
  [service: string]: unknown;

  readonly #config: ResolvedConfig;
  readonly #scope: ScopeDefaults;
  readonly #transport: Transport;

  constructor(config: ClientConfig, scope: ScopeDefaults = {}, transport?: Transport) {
    if (!config || typeof config.apiKey !== "string" || config.apiKey.length === 0) {
      throw new ConnectorError("`apiKey` is required", {
        code: "client_invalid_request",
        status: 0,
      });
    }
    this.#config = {
      apiKey: config.apiKey,
      baseUrl: (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
      organization: config.organization,
      connectionName: config.connectionName,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    };
    this.#scope = scope;
    this.#transport = transport ?? (config.fetch ? { ...defaultTransport, fetch: config.fetch } : defaultTransport);

    // Constructor returns a Proxy (replaces `this`), enabling `oomol.<service>.<action>(...)`.
    return new Proxy(this, {
      get(target, prop) {
        if (typeof prop === "symbol") return Reflect.get(target, prop, target);
        // Defense in depth: never let the top-level object be treated as thenable.
        if (prop === "then") return undefined;
        if (RESERVED.has(prop) || prop in target) {
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        }
        // Otherwise: a service namespace.
        return makeServiceProxy(target, prop);
      },
    }) as ConnectorImpl;
  }

  // --- option resolution ---

  #resolveCall(options?: CallOptions): {
    organization?: string;
    connectionName?: string;
    signal?: AbortSignal;
    timeoutMs: number;
    retries: number;
  } {
    const cfg = this.#config;
    const scope = this.#scope;

    return {
      organization: options?.organization ?? scope.organization ?? cfg.organization,
      // Connection name, resolved with layer precedence (per-call > using() scope > client).
      connectionName: options?.connectionName ?? scope.connectionName ?? cfg.connectionName,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? cfg.timeoutMs,
      retries: options?.retries ?? cfg.maxRetries,
    };
  }

  #buildSpec(
    method: RequestSpec["method"],
    path: string,
    init: {
      body?: unknown;
      query?: Record<string, string | string[] | undefined>;
      options?: CallOptions;
      actionId?: string;
    },
  ): RequestSpec {
    const resolved = this.#resolveCall(init.options);
    const cfg = this.#config;

    const url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, item);
      else url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {};
    headers["authorization"] = `Bearer ${cfg.apiKey}`;
    headers["user-agent"] = USER_AGENT;
    headers["accept"] = "application/json";
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (resolved.organization) headers["x-oo-organization-name"] = resolved.organization;

    // Connection name selector — always carried as a client header (wire key stays `alias`).
    if (resolved.connectionName !== undefined) {
      headers["x-oo-connector-alias"] = resolved.connectionName;
    }

    // Reject CR/LF in any header name or value (response-splitting) before fetch sees them.
    assertHeadersSafe(headers);

    return {
      method,
      url: url.toString(),
      headers,
      body: init.body,
      retries: resolved.retries,
      timeoutMs: resolved.timeoutMs,
      signal: resolved.signal,
      actionId: init.actionId,
    };
  }

  // --- path 1: execute ---

  async execute<A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options?: CallOptions,
  ): Promise<OutputOf<A>> {
    const raw = await this.executeRaw(actionId, input, options);
    return raw.data;
  }

  async executeRaw<A extends ActionId>(
    actionId: A,
    input: InputOf<A>,
    options?: CallOptions,
  ): Promise<RawResult<OutputOf<A>>> {
    const id = String(actionId);
    const spec = this.#buildSpec("POST", `/actions/${encodeURIComponent(id)}`, {
      body: { input },
      options,
      actionId: id,
    });
    const envelope = await send(spec, this.#transport);
    return {
      data: envelope.data as OutputOf<A>,
      executionId: envelope.meta?.executionId,
      actionId: envelope.meta?.actionId ?? id,
      message: envelope.message,
    };
  }

  // --- scoped sub-client ---

  using(scope: ScopeOptions): Connector {
    const merged: ScopeDefaults = {
      organization: scope.organization ?? this.#scope.organization,
      connectionName: scope.connectionName ?? this.#scope.connectionName,
    };
    return new ConnectorImpl(this.#sourceConfig(), merged, this.#transport) as unknown as Connector;
  }

  /** Reconstruct a ClientConfig from resolved state (for `using()` cloning). */
  #sourceConfig(): ClientConfig {
    const cfg = this.#config;
    return {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      organization: cfg.organization,
      connectionName: cfg.connectionName,
      timeoutMs: cfg.timeoutMs,
      maxRetries: cfg.maxRetries,
    };
  }

  // --- proxy passthrough ---

  async proxy<T = unknown>(
    service: string,
    req: ProxyRequest,
    options?: CallOptions,
  ): Promise<ProxyResponse<T>> {
    const spec = this.#buildSpec("POST", `/proxy/${encodeURIComponent(service)}`, {
      body: req,
      options,
    });
    const envelope = await send(spec, this.#transport);
    return envelope.data as ProxyResponse<T>;
  }

  // --- catalog introspection ---

  get catalog(): CatalogApi {
    return {
      action: async (actionId: string, options?: CallOptions): Promise<ActionMetadata> => {
        const spec = this.#buildSpec("GET", `/actions/${encodeURIComponent(actionId)}`, {
          options,
          actionId,
        });
        const envelope = await send(spec, this.#transport);
        return envelope.data as ActionMetadata;
      },
      actions: async (service: string, options?: CallOptions): Promise<ActionMetadata[]> => {
        const spec = this.#buildSpec("GET", `/actions`, {
          query: { service },
          options,
        });
        const envelope = await send(spec, this.#transport);
        return envelope.data as ActionMetadata[];
      },
      providers: async (
        query?: ProviderQuery,
        options?: CallOptions,
      ): Promise<ProviderMetadata[]> => {
        const spec = this.#buildSpec("GET", `/providers`, {
          query: { service: query?.service, q: query?.q },
          options,
        });
        const envelope = await send(spec, this.#transport);
        return envelope.data as ProviderMetadata[];
      },
    };
  }

  // --- connection introspection (read-only) ---

  get apps(): AppsApi {
    return {
      list: async (options?: CallOptions): Promise<ConnectedApp[]> => {
        const spec = this.#buildSpec("GET", `/apps`, { options });
        const envelope = await send(spec, this.#transport);
        // The gateway returns the connection alias as `alias`; surface it as `connectionName`
        // so users only ever see `connectionName`.
        const raw = (envelope.data ?? []) as Array<Record<string, unknown>>;
        return raw.map(({ alias, ...rest }) => ({ ...rest, connectionName: alias ?? null })) as ConnectedApp[];
      },
    };
  }
}

/** The exported constructor, typed to produce the merged {@link Connector} surface. */
export const Connector = ConnectorImpl as unknown as {
  new (config: ClientConfig): Connector;
};
