/**
 * Low-level HTTP transport: header assembly, timeout, retry with backoff, envelope parsing,
 * and error mapping to {@link ConnectorError}. Used by the Connector orchestration layer.
 */

import { ConnectorError, type ConnectorErrorCode, isRetryable } from "./errors";

/** Success/failure envelope shared by all gateway endpoints. */
export interface Envelope<T = unknown> {
  success: boolean;
  message?: string;
  data: T;
  errorCode?: ConnectorErrorCode;
  meta?: {
    executionId?: string;
    actionId?: string;
    service?: string;
    requestId?: string;
    [key: string]: unknown;
  };
}

/** A single resolved request, ready to send. */
export interface RequestSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Absolute URL including query string. */
  url: string;
  headers: Record<string, string>;
  /** JSON-serializable body (omitted for GET). */
  body?: unknown;
  /** Total attempts beyond the first (0 = no retry). */
  retries: number;
  timeoutMs: number;
  signal?: AbortSignal;
  /** Action id for error decoration (when applicable). */
  actionId?: string;
}

/** Transport dependencies (injectable for tests). */
export interface Transport {
  fetch: typeof fetch;
  /**
   * Sleep used between retries; injectable so tests don't actually wait. Receives the caller's
   * abort signal so the default implementation can cancel its timer on abort instead of leaking
   * a pending `setTimeout` (which would otherwise keep the event loop alive after cancellation).
   */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const defaultTransport: Transport = {
  fetch: globalThis.fetch,
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (signal?.aborted) return resolve();
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }),
};

/** Exponential backoff with full jitter, capped. Attempt is 0-based (0 = first retry delay). */
function backoffDelay(attempt: number): number {
  const base = 200; // ms
  const cap = 10_000;
  const exp = Math.min(cap, base * 2 ** attempt);
  // full jitter: random in [0, exp]
  return Math.floor(Math.random() * exp);
}

/** Upper bound on any single inter-attempt wait (so a hostile `Retry-After` cannot pin us). */
const MAX_RETRY_AFTER_MS = 60_000;

function clampWait(ms: number): number {
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

/** Read the `Retry-After` header (seconds or HTTP-date) into ms, clamped to a sane ceiling. */
function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const secs = Number(raw);
  if (Number.isFinite(secs)) return clampWait(secs * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return clampWait(date - Date.now());
  return undefined;
}

/** The idiomatic abort error carried by a signal (its reason, or a standard AbortError). */
export function abortErrorFrom(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

/**
 * Reject CR/LF in any header name or value up front with a non-retryable client error, rather than
 * letting `fetch` throw a TypeError that the status-0 retry path would then retry for the full
 * budget. CRLF in a header is always a response-splitting attempt. Shared by both clients.
 */
export function assertHeadersSafe(headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      throw new ConnectorError("header names and values must not contain CR or LF characters", {
        code: "client_invalid_request",
        status: 0,
      });
    }
  }
}

/** Sleep for `ms`, but resolve early if the caller's signal aborts mid-wait. */
function sleepOrAbort(
  ms: number,
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => resolve();
    signal.addEventListener("abort", onAbort, { once: true });
    // Forward the signal so the default sleep cancels its timer on abort (no lingering timer).
    void sleep(ms, signal).then(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
  });
}

function toConnectorError(
  envelope: Envelope | undefined,
  status: number,
  actionId: string | undefined,
): ConnectorError {
  const code: ConnectorErrorCode =
    envelope?.errorCode ?? (status === 429 ? "rate_limited" : "provider_error");
  // `code` is always a non-empty string (the `??` above guarantees a fallback), so the status
  // line can interpolate it directly — no empty-branch guard needed.
  const message = envelope?.message ?? `Request failed with status ${status} (${code})`;
  return new ConnectorError(message, {
    code,
    status,
    actionId: actionId ?? envelope?.meta?.actionId,
    executionId: envelope?.meta?.executionId,
    requestId: envelope?.meta?.requestId,
    data: envelope?.data ?? undefined,
  });
}

async function parseBody(res: Response): Promise<Envelope | undefined> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Envelope;
  } catch {
    // Non-JSON body. A 2xx payload is still a success — surface the raw text as `data`
    // (e.g. a plain-text "OK", or a 200 page injected by an intermediary). A non-2xx non-JSON
    // body (gateway/proxy error page) becomes an error envelope so it routes to the error path
    // carrying the real (non-200) status — never a contradictory `provider_error` with status 200.
    return res.ok
      ? { success: true, data: text }
      : { success: false, message: text, data: null };
  }
}

/**
 * Execute one request with timeout, retry, and error mapping.
 * Returns the parsed {@link Envelope} on success; throws {@link ConnectorError} on failure.
 */
export async function send(
  spec: RequestSpec,
  transport: Transport = defaultTransport,
): Promise<Envelope> {
  let lastError: unknown;
  // Clamp so a negative `retries` can never skip the loop entirely — which would otherwise fall
  // straight through to the final throw without ever sending a request.
  const maxRetries = Math.max(0, spec.retries);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Bail immediately if the caller has aborted (pre-flight or during a prior wait).
    if (spec.signal?.aborted) throw abortErrorFrom(spec.signal);

    const controller = new AbortController();
    const onAbort = () => controller.abort((spec.signal as AbortSignal).reason);
    if (spec.signal) spec.signal.addEventListener("abort", onAbort, { once: true });

    // Our own per-attempt timeout. The flag makes timeout classification independent of
    // whether the runtime propagates the abort `reason` through fetch.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException("Request timed out", "TimeoutError"));
    }, spec.timeoutMs);

    try {
      const res = await transport.fetch(spec.url, {
        method: spec.method,
        headers: spec.headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        signal: controller.signal,
      });

      const envelope = await parseBody(res);

      if (res.ok && envelope?.success !== false) {
        return envelope ?? { success: true, data: null };
      }

      const err = toConnectorError(envelope, res.status, spec.actionId);
      // Honor Retry-After on 429 if we still have attempts left.
      if (attempt < maxRetries && isRetryable(err)) {
        lastError = err;
        const wait = retryAfterMs(res) ?? backoffDelay(attempt);
        await sleepOrAbort(wait, transport.sleep, spec.signal);
        continue; // loop-top re-checks the abort signal before the next attempt
      }
      throw err;
    } catch (err) {
      // Caller-initiated abort: surface the idiomatic AbortError as-is, never retry.
      if (spec.signal?.aborted) throw abortErrorFrom(spec.signal);
      if (err instanceof ConnectorError) {
        // Already mapped (and not retryable, or out of attempts).
        throw err;
      }
      // Client-side timeout (our AbortController) or transport failure.
      const netErr = new ConnectorError(
        timedOut ? `Request timed out after ${spec.timeoutMs}ms` : "Network request failed",
        {
          code: timedOut ? "client_timeout" : "client_network_error",
          status: 0,
          actionId: spec.actionId,
          cause: err,
        },
      );
      if (attempt < maxRetries) {
        lastError = netErr;
        await sleepOrAbort(backoffDelay(attempt), transport.sleep, spec.signal);
        continue;
      }
      throw netErr;
    } finally {
      clearTimeout(timer);
      if (spec.signal) spec.signal.removeEventListener("abort", onAbort);
    }
  }

  // Unreachable in practice (loop either returns or throws), but satisfies control flow.
  /* v8 ignore next 3 -- defensive: every iteration returns, throws, or continues past here */
  throw lastError instanceof ConnectorError
    ? lastError
    : new ConnectorError("Request failed", { code: "provider_error", status: 0 });
}
