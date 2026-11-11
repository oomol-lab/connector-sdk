import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConnectorError, isRetryable, parseWebhookEvent, verifyWebhook } from "../src/index";

const SECRET = "whsec_current";
const PREVIOUS = "whsec_previous";
const NOW = 1_800_000_000_000;
const T = Math.floor(NOW / 1000);

function sign(secret: string, body: string, timestamp = T) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

const body = JSON.stringify({
  id: "evt_1",
  type: "trigger.message",
  version: 1,
  createdAt: NOW,
  data: {
    subscriptionId: "sub_1",
    triggerId: "gmail.on_message_received",
    definitionVersion: 1,
    externalUserId: "user_42",
    connectedAccountId: "ca_1",
    providerConfigId: "pc_1",
    service: "gmail",
    payload: { messageId: "m_1" },
  },
});

describe("verifyWebhook", () => {
  it("accepts a valid signature over the raw body, as a string or bytes", async () => {
    const signature = `t=${T},v1=${sign(SECRET, body)}`;
    expect(await verifyWebhook({ payload: body, signature, secret: SECRET, now: NOW })).toBe(true);
    expect(
      await verifyWebhook({ payload: new TextEncoder().encode(body), signature, secret: SECRET, now: NOW }),
    ).toBe(true);
  });

  it("rejects a modified body, a wrong secret, and a missing or malformed header", async () => {
    const signature = `t=${T},v1=${sign(SECRET, body)}`;
    expect(await verifyWebhook({ payload: `${body} `, signature, secret: SECRET, now: NOW })).toBe(false);
    expect(await verifyWebhook({ payload: body, signature, secret: "whsec_other", now: NOW })).toBe(false);
    expect(await verifyWebhook({ payload: body, signature: null, secret: SECRET, now: NOW })).toBe(false);
    expect(await verifyWebhook({ payload: body, signature: `v1=${sign(SECRET, body)}`, secret: SECRET, now: NOW })).toBe(
      false,
    );
    // A non-hex character must not be read as a valid prefix.
    const tampered = `0g${sign(SECRET, body).slice(2)}`;
    expect(await verifyWebhook({ payload: body, signature: `t=${T},v1=${tampered}`, secret: SECRET, now: NOW })).toBe(
      false,
    );
  });

  it("rejects timestamps outside the tolerance window", async () => {
    const old = T - 301;
    const signature = `t=${old},v1=${sign(SECRET, body, old)}`;
    expect(await verifyWebhook({ payload: body, signature, secret: SECRET, now: NOW })).toBe(false);
    expect(await verifyWebhook({ payload: body, signature, secret: SECRET, now: NOW, toleranceSeconds: 600 })).toBe(true);
  });

  it("accepts any matching v1 during a rotation, and any of several local secrets", async () => {
    const rotation = `t=${T},v1=${sign(SECRET, body)},v1=${sign(PREVIOUS, body)}`;
    expect(await verifyWebhook({ payload: body, signature: rotation, secret: PREVIOUS, now: NOW })).toBe(true);
    const single = `t=${T},v1=${sign(SECRET, body)}`;
    expect(await verifyWebhook({ payload: body, signature: single, secret: [PREVIOUS, SECRET], now: NOW })).toBe(true);
  });
});

describe("parseWebhookEvent", () => {
  it("returns the typed event after verification", async () => {
    const event = await parseWebhookEvent({
      payload: body,
      signature: `t=${T},v1=${sign(SECRET, body)}`,
      secret: SECRET,
      now: NOW,
    });
    expect(event.type).toBe("trigger.message");
    if (event.type === "trigger.message") expect(event.data.payload).toEqual({ messageId: "m_1" });
  });

  it("throws a non-retryable client_invalid_signature when verification fails", async () => {
    const error = await parseWebhookEvent({ payload: body, signature: `t=${T},v1=00`, secret: SECRET, now: NOW }).catch(
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).code).toBe("client_invalid_signature");
    expect(isRetryable(error)).toBe(false);
  });

  it("throws client_invalid_request when a verified body is not an event envelope", async () => {
    const notEnvelope = JSON.stringify({ hello: "world" });
    await expect(
      parseWebhookEvent({
        payload: notEnvelope,
        signature: `t=${T},v1=${sign(SECRET, notEnvelope)}`,
        secret: SECRET,
        now: NOW,
      }),
    ).rejects.toMatchObject({ code: "client_invalid_request" });
  });
});
