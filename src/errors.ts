/**
 * Typed error model.
 *
 * The backend `errorCode` is a stable enum; we surface it as a discriminable union plus a
 * typed exception. `| (string & {})` keeps the union OPEN for forward compatibility with
 * backend codes the SDK hasn't enumerated yet.
 */

export type ConnectorErrorCode =
  // Backend error codes:
  | "invalid_input"
  | "invalid_request_signature"
  | "invalid_request_payload"
  | "app_not_found"
  | "app_not_ready"
  | "app_auth_type_mismatch"
  | "provider_not_found"
  | "provider_not_configured"
  | "provider_config_not_found"
  | "provider_error"
  | "credential_expired"
  | "scope_missing"
  | "user_oauth_client_required"
  | "connection_ambiguous"
  | "connection_account_conflict"
  | "connection_alias_conflict"
  | "connection_request_not_found"
  | "connected_account_not_found"
  | "rate_limited"
  | "proxy_not_supported"
  | "proxy_upstream_error"
  | "proxy_upstream_timeout"
  | "proxy_response_too_large"
  | "request_key_conflict"
  | "request_key_used"
  | "request_in_progress"
  | "subscription_creating"
  | "subscription_exists"
  | "subscription_cleaning_up"
  | "subscription_needs_recreate"
  // Client-only extension codes (NOT in the backend enum; do not overlap with it).
  // Held by the `| (string & {})` open union.
  | "client_invalid_request" // local precheck failure (e.g. missing apiKey, illegal header) — not sent
  | "client_timeout" // request exceeded the client-side `timeoutMs`
  | "client_network_error" // transport-level failure (DNS/connection/fetch threw)
  | "client_wait_timeout" // `ProjectConnector.waitForConnection` exceeded its overall `maxWaitMs` (NOT a per-request timeout)
  // Forward-compat for new backend codes:
  | (string & {});

/** Fields used to construct a {@link ConnectorError}. */
export interface ConnectorErrorInit {
  code: ConnectorErrorCode;
  /** HTTP status (0 for client-side / network errors). */
  status: number;
  actionId?: string;
  executionId?: string;
  /** Upstream response body (e.g. on `provider_error`). */
  data?: unknown;
  requestId?: string;
  /** Underlying error (network/abort), preserved for debugging. */
  cause?: unknown;
}

/** Typed exception thrown by all SDK calls on failure. */
export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly status: number;
  readonly actionId?: string;
  readonly executionId?: string;
  readonly data?: unknown;
  readonly requestId?: string;

  constructor(message: string, init: ConnectorErrorInit) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ConnectorError";
    this.code = init.code;
    this.status = init.status;
    this.actionId = init.actionId;
    this.executionId = init.executionId;
    this.data = init.data;
    this.requestId = init.requestId;
    // Restore prototype chain for `instanceof` across transpilation targets.
    Object.setPrototypeOf(this, ConnectorError.prototype);
  }
}

/** Backend codes that are safe to retry (in addition to HTTP-status / network heuristics). */
const RETRYABLE_CODES: ReadonlySet<string> = new Set([
  "rate_limited",
  "proxy_upstream_timeout",
  "request_in_progress",
]);

/**
 * Convenience predicate: is this error worth retrying?
 * Retries on `rate_limited`, transient proxy/timeout codes, HTTP 429, 5xx, and
 * network/client-side errors (status 0). Client validation errors are never retryable.
 */
export function isRetryable(err: unknown): boolean {
  if (!(err instanceof ConnectorError)) return false;
  // Client-side terminal conditions: a local precheck never sent, and a `waitForConnection`
  // wall-clock cap. Both carry status 0 but must NOT fall through to the status-0 retry heuristic
  // below — retrying neither helps (the request was invalid / the user never finished authorizing).
  if (err.code === "client_invalid_request" || err.code === "client_wait_timeout") return false;
  if (RETRYABLE_CODES.has(err.code)) return true;
  if (err.status === 429) return true;
  if (err.status >= 500 && err.status <= 599) return true;
  if (err.status === 0) return true; // network / abort-less transport failure
  return false;
}
