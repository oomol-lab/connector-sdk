import { describe, expect, it } from "vitest";
import { ConnectorError, isRetryable, type ConnectorErrorCode } from "../src/index";
import { fail, recorder } from "./helpers";

const ALL_CODES: ConnectorErrorCode[] = [
  "invalid_input",
  "invalid_request_signature",
  "invalid_request_payload",
  "app_not_found",
  "app_not_ready",
  "app_auth_type_mismatch",
  "provider_not_found",
  "provider_not_configured",
  "provider_error",
  "credential_expired",
  "scope_missing",
  "user_oauth_client_required",
  "connection_ambiguous",
  "connection_account_conflict",
  "connection_alias_conflict",
  "rate_limited",
  "proxy_not_supported",
  "proxy_upstream_error",
  "proxy_upstream_timeout",
  "proxy_response_too_large",
  "request_key_conflict",
  "request_key_used",
  "request_in_progress",
  "subscription_creating",
  "subscription_exists",
  "subscription_cleaning_up",
  "subscription_needs_recreate",
];

describe("M1 — error model", () => {
  it("maps a failure envelope into a ConnectorError with full metadata", async () => {
    const { oomol } = recorder(() =>
      fail("provider_error", 502, {
        message: "upstream boom",
        data: { upstream: "details" },
        meta: { executionId: "e-1", actionId: "svc.act", requestId: "r-1" },
      }),
    );
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe("provider_error");
    expect(err.status).toBe(502);
    expect(err.actionId).toBe("svc.act");
    expect(err.executionId).toBe("e-1");
    expect(err.requestId).toBe("r-1");
    expect(err.data).toEqual({ upstream: "details" });
    expect(err.message).toBe("upstream boom");
  });

  it.each(ALL_CODES)("passes through backend errorCode %s", async (code) => {
    // Use 400 so retryable codes (rate_limited etc.) don't loop; we only assert mapping.
    const { oomol } = recorder(() => fail(code, 400), { maxRetries: 0 });
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe(code);
  });

  it("unknown forward-compat code survives (open union)", async () => {
    const { oomol } = recorder(() => fail("brand_new_backend_code", 400), { maxRetries: 0 });
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err.code).toBe("brand_new_backend_code");
  });

  it("ConnectorError is instanceof Error and Error.cause is preserved", async () => {
    const { oomol } = recorder(() => fail("invalid_input", 400), { maxRetries: 0 });
    const err = await oomol.execute("svc.act", {}).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ConnectorError");
  });

  describe("isRetryable", () => {
    it("true for rate_limited / 429 / 5xx / network(status 0)", () => {
      expect(isRetryable(new ConnectorError("x", { code: "rate_limited", status: 429 }))).toBe(true);
      expect(isRetryable(new ConnectorError("x", { code: "provider_error", status: 503 }))).toBe(true);
      expect(isRetryable(new ConnectorError("x", { code: "client_network_error", status: 0 }))).toBe(true);
      expect(isRetryable(new ConnectorError("x", { code: "client_timeout", status: 0 }))).toBe(true);
      expect(isRetryable(new ConnectorError("x", { code: "proxy_upstream_timeout", status: 504 }))).toBe(true);
    });
    it("false for client_invalid_request and 4xx", () => {
      expect(isRetryable(new ConnectorError("x", { code: "client_invalid_request", status: 0 }))).toBe(false);
      expect(isRetryable(new ConnectorError("x", { code: "invalid_input", status: 400 }))).toBe(false);
    });
    it("false for non-ConnectorError", () => {
      expect(isRetryable(new Error("x"))).toBe(false);
      expect(isRetryable("nope")).toBe(false);
    });
  });
});
