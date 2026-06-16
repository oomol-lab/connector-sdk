import { describe, expect, it } from "vitest";
import { Connector } from "../src/index";
import type { ClientConfig } from "../src/index";

/** A fetch that always returns a success envelope, capturing the last request. */
function mockClient(overrides?: Partial<ClientConfig>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const envelope = {
      success: true,
      message: "OK",
      data: { ok: true },
      meta: { executionId: "exec-1", actionId: "svc.action" },
    };
    return new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const oomol = new Connector({ apiKey: "k", fetch: fetchMock, ...overrides });
  return { oomol, calls };
}

describe("M0 — two-layer Proxy & thenable trap", () => {
  it("constructor returns a Proxy; reserved members survive and are callable", () => {
    const { oomol } = mockClient();
    expect(typeof oomol.execute).toBe("function");
    expect(typeof oomol.executeRaw).toBe("function");
    expect(typeof oomol.using).toBe("function");
    expect(typeof oomol.proxy).toBe("function");
    expect(typeof oomol.catalog).toBe("object");
    expect(typeof oomol.catalog.action).toBe("function");
    expect(typeof oomol.apps).toBe("object");
  });

  it("reserved members actually execute (mock fetch)", async () => {
    const { oomol, calls } = mockClient();
    const data = await oomol.execute("svc.action", { a: 1 });
    expect(data).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/actions/svc.action");
  });

  it("top-level `then` is undefined (await on client does not hang)", () => {
    const { oomol } = mockClient();
    expect((oomol as unknown as Record<string, unknown>).then).toBeUndefined();
  });

  it("second-level service Proxy: `then`/`catch`/`finally` and symbols return undefined", () => {
    const { oomol } = mockClient();
    const svc = oomol.anyService as unknown as Record<PropertyKey, unknown>;
    expect(svc.then).toBeUndefined();
    expect(svc.catch).toBeUndefined();
    expect(svc.finally).toBeUndefined();
    expect(svc[Symbol.iterator]).toBeUndefined();
    expect(svc[Symbol.toPrimitive]).toBeUndefined();
    // any normal key resolves to a callable
    expect(typeof svc.anyAction).toBe("function");
  });

  it("`await oomol.<service>` resolves immediately and does NOT hang", async () => {
    const { oomol } = mockClient();
    const sentinel = Symbol("timeout");
    const result = await Promise.race([
      (async () => {
        // If the second-level Proxy were thenable, this await would hang forever.
        const svc = await (oomol.someService as unknown as Promise<unknown>);
        return svc;
      })(),
      new Promise((resolve) => setTimeout(() => resolve(sentinel), 200)),
    ]);
    expect(result).not.toBe(sentinel);
  });

  it("namespace call forwards to execute with `${service}.${action}`", async () => {
    const { oomol, calls } = mockClient();
    await (oomol as any).gmail.search_threads({ query: "x" });
    expect(calls[0]!.url).toContain("/actions/gmail.search_threads");
  });

  it("await on a namespace ACTION (a real promise) still works", async () => {
    const { oomol } = mockClient();
    const data = await (oomol as any).gmail.search_threads({ query: "x" });
    expect(data).toEqual({ ok: true });
  });

  it("falls back to the default transport when neither transport nor config.fetch is given", () => {
    // Construction alone exercises the defaultTransport branch — no request is sent.
    const oomol = new Connector({ apiKey: "k" });
    expect(typeof oomol.execute).toBe("function");
  });

  it("top-level symbol access routes through Reflect.get, not a service namespace", () => {
    const { oomol } = mockClient();
    // A symbol key must hit Reflect.get on the target (undefined here), never be coerced
    // into a `${service}` namespace string.
    expect((oomol as unknown as Record<PropertyKey, unknown>)[Symbol.iterator]).toBeUndefined();
  });
});
