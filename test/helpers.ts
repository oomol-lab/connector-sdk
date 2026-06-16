import { Connector } from "../src/index";
import type { ClientConfig } from "../src/index";

export interface CapturedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface Recorder {
  oomol: Connector;
  calls: CapturedCall[];
  sleeps: number[];
}

type Handler = (call: CapturedCall, attempt: number) => Response | Promise<Response>;

/** JSON success envelope helper. */
export function ok(data: unknown, meta?: Record<string, unknown>, status = 200): Response {
  return new Response(
    JSON.stringify({ success: true, message: "OK", data, meta }),
    { status, headers: { "content-type": "application/json" } },
  );
}

/** JSON failure envelope helper. */
export function fail(
  errorCode: string,
  status: number,
  opts: { message?: string; data?: unknown; meta?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Response {
  return new Response(
    JSON.stringify({
      success: false,
      message: opts.message ?? errorCode,
      data: opts.data ?? null,
      errorCode,
      meta: opts.meta,
    }),
    { status, headers: { "content-type": "application/json", ...opts.headers } },
  );
}

/**
 * Build a Connector backed by a programmable fetch, with an injected no-op `sleep`
 * (so retry backoff does not actually wait). Records requests and sleep durations.
 */
export function recorder(
  handler: Handler,
  config: Partial<ClientConfig> = {},
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Recorder {
  const calls: CapturedCall[] = [];
  const sleeps: number[] = [];
  let attempt = 0;

  const fetchImpl: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const call: CapturedCall = {
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const result = Promise.resolve(handler(call, attempt++));

    // Faithfully honor the abort signal the SDK passes (its timeout / caller cancellation):
    // reject as soon as the signal aborts, mirroring real fetch.
    const signal = init?.signal ?? undefined;
    if (!signal) return result;
    if (signal.aborted) throw signal.reason ?? new DOMException("aborted", "AbortError");
    return await new Promise<Response>((resolve, reject) => {
      signal.addEventListener(
        "abort",
        () => reject(signal.reason ?? new DOMException("aborted", "AbortError")),
        { once: true },
      );
      result.then(resolve, reject);
    });
  };

  const transport = {
    fetch: fetchImpl,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      if (opts.sleep) await opts.sleep(ms);
    },
  };

  // Use the internal (config, scope, transport) constructor arity for sleep injection.
  const Ctor = Connector as unknown as new (
    config: ClientConfig,
    scope?: unknown,
    transport?: unknown,
  ) => Connector;
  const oomol = new Ctor({ apiKey: "test-key", ...config }, undefined, transport);
  return { oomol, calls, sleeps };
}
