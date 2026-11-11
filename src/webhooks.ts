/**
 * Project webhook helpers: verify the `x-oo-signature` header and parse the event envelope.
 *
 * Connector signs every delivery with HMAC-SHA256 over `<t>.<raw body>`, keyed with the webhook's
 * signing secret, and sends `x-oo-signature: t=<unix seconds>,v1=<hex>`. During a secret rotation the
 * header carries one `v1` per active secret; a delivery is valid when ANY of them matches. Uses the
 * Web Crypto API, so it runs unchanged on Node 19+, Bun, Deno, and edge runtimes.
 */

import { ConnectorError } from "./errors";

/** The header carrying the delivery signature. */
export const WEBHOOK_SIGNATURE_HEADER = "x-oo-signature";

const DEFAULT_TOLERANCE_SECONDS = 300;

/** Input for {@link verifyWebhook} and {@link parseWebhookEvent}. */
export interface VerifyWebhookInput {
  /**
   * The RAW request body exactly as received. Verify before any JSON parsing: re-serializing a
   * parsed body changes the bytes and breaks the signature.
   */
  payload: string | Uint8Array;
  /** The `x-oo-signature` header value. */
  signature: string | null | undefined;
  /**
   * The webhook signing secret (`whsec_…`). Pass several to accept any of them, for example the new
   * and the previous secret while you deploy a rotation.
   */
  secret: string | readonly string[];
  /** Maximum allowed clock skew between the signature timestamp and now. Default 300 seconds. */
  toleranceSeconds?: number;
  /** Current time in Unix milliseconds; injectable for tests. Defaults to `Date.now()`. */
  now?: number;
}

/** The account a connection event refers to. `id` and `status` are `null` on `connection.failed`. */
export interface WebhookConnectionAccount {
  id: string | null;
  /** The connection's name (the SDK's `connectionName`), or `null`. Kept as the wire field. */
  alias: string | null;
  status: string | null;
  authType: "oauth2" | "api_key" | "custom_credential" | (string & {});
}

/** `data` of `connection.succeeded` / `connection.failed`. */
export interface ConnectionWebhookEventData {
  /** The OAuth connection request, or `null` for synchronous credential connections. */
  connectionRequestId: string | null;
  /** The end-user id your backend sent when connecting. */
  externalUserId: string;
  account: WebhookConnectionAccount;
  app: {
    service: string;
    providerConfigId: string;
    slug: string | null;
    displayName: string | null;
  };
  /** Present on `connection.failed` only. */
  error?: { code: string; message: string };
}

/** `data` of `trigger.message`. */
export interface TriggerMessageWebhookEventData {
  subscriptionId: string;
  triggerId: string;
  /** The Trigger definition version the subscription is pinned to. */
  definitionVersion: number;
  externalUserId: string;
  connectedAccountId: string;
  providerConfigId: string;
  service: string;
  /** The event body; follows the Trigger type's `eventSchema`. */
  payload: Record<string, unknown>;
}

interface WebhookEventEnvelope<T extends string, D> {
  /** Stable across retries and across webhooks; deduplicate on it. */
  id: string;
  type: T;
  /** The payload version pinned on the webhook. */
  version: number;
  /** Unix milliseconds. */
  createdAt: number;
  data: D;
}

export type ConnectionSucceededWebhookEvent = WebhookEventEnvelope<"connection.succeeded", ConnectionWebhookEventData>;
export type ConnectionFailedWebhookEvent = WebhookEventEnvelope<"connection.failed", ConnectionWebhookEventData>;
export type TriggerMessageWebhookEvent = WebhookEventEnvelope<"trigger.message", TriggerMessageWebhookEventData>;

/**
 * A verified project webhook event. Switch on `type`; new event types may be added later, so ignore
 * types your receiver does not handle instead of rejecting them.
 */
export type WebhookEvent = ConnectionSucceededWebhookEvent | ConnectionFailedWebhookEvent | TriggerMessageWebhookEvent;

export type WebhookEventType = WebhookEvent["type"];

/**
 * Verify a delivery's signature. Resolves `false` for a missing or malformed header, a timestamp
 * outside the tolerance window, or no matching signature; it never throws for those.
 */
export async function verifyWebhook(input: VerifyWebhookInput): Promise<boolean> {
  const parsed = parseSignatureHeader(input.signature);
  if (!parsed) return false;
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > tolerance) return false;

  const subtle = requireSubtleCrypto();
  const encoder = new TextEncoder();
  const body = typeof input.payload === "string" ? encoder.encode(input.payload) : input.payload;
  const prefix = encoder.encode(`${parsed.timestamp}.`);
  const signed = new Uint8Array(prefix.length + body.length);
  signed.set(prefix);
  signed.set(body, prefix.length);

  const secrets = typeof input.secret === "string" ? [input.secret] : input.secret;
  for (const secret of secrets) {
    const key = await subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "verify",
    ]);
    for (const signature of parsed.signatures) {
      // subtle.verify compares in constant time.
      if (await subtle.verify("HMAC", key, signature, signed)) return true;
    }
  }
  return false;
}

/**
 * Verify a delivery and return its parsed event. Throws {@link ConnectorError} with code
 * `client_invalid_signature` when verification fails, and `client_invalid_request` when the verified
 * body is not a JSON event envelope.
 */
export async function parseWebhookEvent(input: VerifyWebhookInput): Promise<WebhookEvent> {
  if (!(await verifyWebhook(input))) {
    throw new ConnectorError("Webhook signature verification failed", {
      code: "client_invalid_signature",
      status: 0,
    });
  }
  const text = typeof input.payload === "string" ? input.payload : new TextDecoder().decode(input.payload);
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch (cause) {
    throw new ConnectorError("Webhook payload is not valid JSON", { code: "client_invalid_request", status: 0, cause });
  }
  if (!isEnvelope(event)) {
    throw new ConnectorError("Webhook payload is not an event envelope", { code: "client_invalid_request", status: 0 });
  }
  return event as WebhookEvent;
}

function parseSignatureHeader(header: string | null | undefined) {
  if (!header) return null;
  let timestamp = Number.NaN;
  const signatures: Uint8Array<ArrayBuffer>[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") {
      const bytes = hexToBytes(value);
      if (bytes) signatures.push(bytes);
    }
  }
  if (!Number.isInteger(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

const HEX_DIGITS = "0123456789abcdefABCDEF";

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  // Reject any non-hex character up front: parseInt would silently accept a valid prefix ("0g" → 0).
  for (const char of hex) if (!HEX_DIGITS.includes(char)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function isEnvelope(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.type === "string" &&
    typeof record.data === "object" &&
    record.data !== null
  );
}

function requireSubtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new ConnectorError(
      "Web Crypto is unavailable; webhook verification needs globalThis.crypto.subtle (Node 19+, Bun, Deno, or an edge runtime)",
      { code: "client_invalid_request", status: 0 },
    );
  }
  return subtle;
}
