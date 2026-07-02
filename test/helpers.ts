import { Connector, OpenConnector, ProjectConnector } from "../src/index";
import type { ClientConfig, OpenConnectorConfig, ProjectConnectorConfig } from "../src/index";

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

export interface ProjectRecorder {
  project: ProjectConnector;
  calls: CapturedCall[];
  sleeps: number[];
}

export interface OpenRecorder {
  open: OpenConnector;
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

/** The self-hosted runtime's non-envelope failure shape (`{ error: { code, message } }`). */
export function runtimeFail(code: string, status: number, message = code): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
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

interface RecordingTransport {
  transport: { fetch: typeof fetch; sleep: (ms: number, signal?: AbortSignal) => Promise<void> };
  calls: CapturedCall[];
  sleeps: number[];
}

/** A programmable fetch + injected `sleep` (no real waiting), recording requests and sleep durations. */
function makeRecordingTransport(
  handler: Handler,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): RecordingTransport {
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
    // Record the requested duration and (like the real transport) resolve EARLY if the caller's
    // signal aborts mid-wait — so abort-during-poll paths (e.g. waitForConnection) are exercisable
    // without real time passing.
    sleep: (ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve) => {
        sleeps.push(ms);
        if (signal?.aborted) return resolve();
        signal?.addEventListener("abort", () => resolve(), { once: true });
        void (async () => {
          if (opts.sleep) await opts.sleep(ms);
          resolve();
        })();
      }),
  };

  return { transport, calls, sleeps };
}

/**
 * Build a Connector (personal client) backed by a programmable fetch + injected no-op `sleep`.
 * Records requests and sleep durations.
 */
export function recorder(
  handler: Handler,
  config: Partial<ClientConfig> = {},
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Recorder {
  const { transport, calls, sleeps } = makeRecordingTransport(handler, opts);
  // Use the internal (config, scope, transport) constructor arity for transport injection.
  const Ctor = Connector as unknown as new (
    config: ClientConfig,
    scope?: unknown,
    transport?: unknown,
  ) => Connector;
  const oomol = new Ctor({ apiKey: "test-key", ...config }, undefined, transport);
  return { oomol, calls, sleeps };
}

/** Build an OpenConnector backed by the same recording transport. */
export function openRecorder(
  handler: Handler,
  config: OpenConnectorConfig = {},
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): OpenRecorder {
  const { transport, calls, sleeps } = makeRecordingTransport(handler, opts);
  // Use the internal (config, transport) constructor arity for transport injection.
  const Ctor = OpenConnector as unknown as new (
    config?: OpenConnectorConfig,
    transport?: unknown,
  ) => OpenConnector;
  const open = new Ctor(config, transport);
  return { open, calls, sleeps };
}

/** Build a ProjectConnector backed by the same recording transport. */
export function projectRecorder(
  handler: Handler,
  config: Partial<ProjectConnectorConfig> = {},
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): ProjectRecorder {
  const { transport, calls, sleeps } = makeRecordingTransport(handler, opts);
  // Use the internal (config, transport) constructor arity for transport injection.
  const Ctor = ProjectConnector as unknown as new (
    config: ProjectConnectorConfig,
    transport?: unknown,
  ) => ProjectConnector;
  const project = new Ctor({ apiKey: "oo_proj_test", ...config }, transport);
  return { project, calls, sleeps };
}
