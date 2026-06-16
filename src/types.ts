/**
 * Public value-level types for the core runtime.
 */

/** Construction config. */
export interface ClientConfig {
  /** API key. Sent as `Authorization: Bearer <apiKey>`. Required. */
  apiKey: string;
  /**
   * Gateway base URL. Defaults to production `https://connector.oomol.com/v1`.
   * Only manual override is supported — there is no env-based auto-switching.
   */
  baseUrl?: string;
  /** Client-level default organization name → `x-oo-organization-name`. */
  organization?: string;
  /** Client-level default connection name (weak semantics — see README; prefer per-call / `using()`). */
  connectionName?: string;
  /** Per-request timeout in ms. Default 30_000. */
  timeoutMs?: number;
  /** Max retries for 429 / 5xx / network errors (exponential backoff + jitter). Default 2. */
  maxRetries?: number;
  /** Injectable fetch for testing / custom agents. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

/** Per-call options. Priority: per-call > `using()` scope > client default. */
export interface CallOptions {
  /** Override default organization name → `x-oo-organization-name`. */
  organization?: string;
  /** Override default connection name → `X-Oo-Connector-Alias`. */
  connectionName?: string;
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
  /** Override per-request timeout in ms. */
  timeoutMs?: number;
  /** Override retry count for this call. */
  retries?: number;
}

/** Scope accepted by `using()` — the subset of {@link CallOptions} that makes sense as a default. */
export type ScopeOptions = Pick<CallOptions, "organization" | "connectionName">;

/** Raw result returned by `executeRaw`, exposing execution metadata. */
export interface RawResult<T = unknown> {
  /** The action output (same value `execute` returns directly). */
  data: T;
  /** Server-assigned execution id (from `meta.executionId`). */
  executionId?: string;
  /** Echoed action id (from `meta.actionId`). */
  actionId?: string;
  /** Human-readable message from the success envelope. */
  message?: string;
}

/** HTTP methods accepted by the proxy passthrough. */
export type ProxyMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Proxy passthrough request body (`.strict()` on the backend — extra keys are rejected). */
export interface ProxyRequest {
  /**
   * Upstream endpoint: a path (resolved against the provider's base URL) OR a full URL — e.g. a
   * regional host like `https://eu.posthog.com/api/...`. Field name is `endpoint`, NOT `path`.
   */
  endpoint: string;
  method: ProxyMethod;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Proxy passthrough success payload. */
export interface ProxyResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

/** A category tag on a provider. */
export interface ProviderCategory {
  id: string;
  displayName: string;
}

/** Provider metadata (`GET /v1/providers`). */
export interface ProviderMetadata {
  service: string;
  displayName: string;
  iconUrl: string | null;
  homepageUrl: string | null;
  categories: ProviderCategory[];
  authTypes: string[];
}

/**
 * Single action metadata (`GET /v1/actions/{actionId}`).
 * `inputSchema`/`outputSchema` are runtime JSON Schema objects — this is runtime
 * introspection, orthogonal to compile-time type augmentation (the types package does NOT
 * enhance these).
 */
export interface ActionMetadata {
  id: string;
  service: string;
  name: string;
  description?: string;
  requiredScopes?: string[];
  providerPermissions?: unknown;
  followUpActions?: string[];
  asyncLifecycle?: unknown;
  /** JSON Schema (2020-12) for the action input. */
  inputSchema: Record<string, unknown>;
  /** JSON Schema (2020-12) for the action output. */
  outputSchema: Record<string, unknown>;
}

/** Server-side filter for `catalog.providers` (`GET /v1/providers`). */
export interface ProviderQuery {
  /** Restrict to these provider service ids → repeated `?service=` query params. */
  service?: string[];
  /** Free-text provider search query → `?q=`. */
  q?: string;
}

/** Catalog / metadata introspection surface. */
export interface CatalogApi {
  /** `GET /v1/actions/{actionId}` — full metadata for one action (404 ⇒ unknown action). */
  action(actionId: string, options?: CallOptions): Promise<ActionMetadata>;
  /** `GET /v1/actions?service=X` — all actions of a service. */
  actions(service: string, options?: CallOptions): Promise<ActionMetadata[]>;
  /** `GET /v1/providers` — list providers, optionally narrowed server-side by service id(s) / search query. */
  providers(query?: ProviderQuery, options?: CallOptions): Promise<ProviderMetadata[]>;
}

/** A connected app (`GET /v1/apps`). */
export interface ConnectedApp {
  /** Connection id (uuid) assigned by the gateway. */
  id: string;
  service: string;
  status?: string;
  /** Connection name, or `null` when none is set. Pass it back as the per-call `connectionName`. */
  connectionName: string | null;
  /** Additional gateway fields (displayName, isDefault, authType, credentialSummary, …). */
  [key: string]: unknown;
}

/** Connection introspection surface (read-only). */
export interface AppsApi {
  /** `GET /v1/apps` — list connected apps. */
  list(options?: CallOptions): Promise<ConnectedApp[]>;
}
