import { describe, expect, it } from "vitest";
import { fail, ok, projectRecorder } from "./helpers";

const BASE = "https://connector.oomol.com/v1";

const billing = {
  state: "allowed",
  checkedAt: 1_800_000_000_000,
  nextCheckAt: 1_800_000_030_000,
  blockedAt: null,
  retentionUntil: null,
  buffer: { pending: 0, maxPending: 10_000 },
  gap: { rejectedAttempts: 0, expiredEvents: 0, lastGapAt: null },
};

/** A subscription wire payload (gateway shape: `userId`). */
function subscriptionPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    userId: "user_42",
    connectedAccountId: "ca_1",
    triggerId: "googlesheets.on_row_added",
    definitionVersion: 2,
    config: { spreadsheetId: "s_1", sheet: "Orders" },
    status: "active",
    pauseReason: null,
    pauseDetail: null,
    type: "poll",
    push: null,
    poll: { intervalSeconds: 300, initialized: false, nextPollAt: 1_800_000_000_000 },
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    deletedAt: null,
    billing,
    ...overrides,
  };
}

describe("ProjectConnector — triggers", () => {
  it("listTypes filters by service; getType reads one Trigger", async () => {
    const type = { id: "googlesheets.on_row_added", type: "poll", service: "googlesheets" };
    const { project, calls } = projectRecorder((call) => ok(call.url.includes("?") ? [type] : type));

    expect(await project.triggers.listTypes({ service: "googlesheets" })).toEqual([type]);
    await project.triggers.getType("googlesheets.on_row_added");

    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["GET", `${BASE}/saas/trigger-types?service=googlesheets`],
      ["GET", `${BASE}/saas/trigger-types/googlesheets.on_row_added`],
    ]);
  });

  it("subscribe sends wire `userId`, an Idempotency-Key, and surfaces `externalUserId`", async () => {
    const { project, calls } = projectRecorder(() => ok(subscriptionPayload(), undefined, 201));
    const subscription = await project.triggers.subscribe(
      "user_42",
      {
        connectedAccountId: "ca_1",
        triggerId: "googlesheets.on_row_added",
        config: { spreadsheetId: "s_1", sheet: "Orders" },
        intervalSeconds: 300,
      },
      { idempotencyKey: "orders-user_42" },
    );

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${BASE}/saas/trigger-subscriptions`);
    expect(calls[0]!.headers["idempotency-key"]).toBe("orders-user_42");
    expect(calls[0]!.body).toEqual({
      userId: "user_42",
      connectedAccountId: "ca_1",
      triggerId: "googlesheets.on_row_added",
      config: { spreadsheetId: "s_1", sheet: "Orders" },
      intervalSeconds: 300,
    });
    expect(subscription.externalUserId).toBe("user_42");
    expect("userId" in subscription).toBe(false);
    expect(subscription.billing.state).toBe("allowed");
  });

  it("subscribe generates one Idempotency-Key and reuses it on retries", async () => {
    const { project, calls } = projectRecorder((_call, attempt) =>
      attempt === 0 ? fail("internal_error", 503) : ok(subscriptionPayload(), undefined, 201),
    );
    await project.triggers.subscribe("user_42", { connectedAccountId: "ca_1", triggerId: "gmail.on_message_received" });

    expect(calls).toHaveLength(2);
    const key = calls[0]!.headers["idempotency-key"];
    expect(key).toEqual(expect.any(String));
    expect(calls[1]!.headers["idempotency-key"]).toBe(key);
    // config and intervalSeconds are omitted when not provided.
    expect(calls[0]!.body).toEqual({ userId: "user_42", connectedAccountId: "ca_1", triggerId: "gmail.on_message_received" });
  });

  it("subscribe fails before sending when no Idempotency-Key can be generated", async () => {
    const { project, calls } = projectRecorder(() => ok(subscriptionPayload(), undefined, 201));
    const original = Object.getOwnPropertyDescriptor(globalThis.crypto, "randomUUID");
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      await expect(
        project.triggers.subscribe("user_42", { connectedAccountId: "ca_1", triggerId: "gmail.on_message_received" }),
      ).rejects.toMatchObject({ code: "client_invalid_request" });
      expect(calls).toHaveLength(0);
      // A caller-supplied key needs no generator.
      await project.triggers.subscribe(
        "user_42",
        { connectedAccountId: "ca_1", triggerId: "gmail.on_message_received" },
        { idempotencyKey: "fixed" },
      );
      expect(calls[0]!.headers["idempotency-key"]).toBe("fixed");
    } finally {
      if (original) Object.defineProperty(globalThis.crypto, "randomUUID", original);
      else delete (globalThis.crypto as { randomUUID?: unknown }).randomUUID;
    }
  });

  it("listSubscriptions maps filters to the query and reads total and billing from meta", async () => {
    const { project, calls } = projectRecorder(() =>
      ok([subscriptionPayload()], { total: 1, limit: 50, offset: 0, billing }),
    );
    const page = await project.triggers.listSubscriptions({ externalUserId: "user_42", status: "paused", limit: 50 });

    expect(calls[0]!.url).toBe(`${BASE}/saas/trigger-subscriptions?userId=user_42&status=paused&limit=50`);
    expect(page.total).toBe(1);
    expect(page.billing).toEqual(billing);
    expect(page.data[0]!.externalUserId).toBe("user_42");
  });

  it("updateSubscription PATCHes and deleteSubscription DELETEs the subscription path", async () => {
    const { project, calls } = projectRecorder((call) =>
      ok(subscriptionPayload(call.method === "DELETE" ? { status: "deleted" } : { status: "paused" })),
    );
    const paused = await project.triggers.updateSubscription("sub_1", { status: "paused" });
    const deleted = await project.triggers.deleteSubscription("sub_1");

    expect(calls.map((call) => [call.method, call.url, call.body])).toEqual([
      ["PATCH", `${BASE}/saas/trigger-subscriptions/sub_1`, { status: "paused" }],
      ["DELETE", `${BASE}/saas/trigger-subscriptions/sub_1`, undefined],
    ]);
    expect(paused.status).toBe("paused");
    expect(deleted.status).toBe("deleted");
  });

  it("forUser binds the end-user for subscribe and listSubscriptions", async () => {
    const { project, calls } = projectRecorder((call) =>
      call.method === "GET"
        ? ok([], { total: 0, limit: 20, offset: 0, billing })
        : ok(subscriptionPayload(), undefined, 201),
    );
    const user = project.forUser("user_42");
    await user.triggers.subscribe({ connectedAccountId: "ca_1", triggerId: "gmail.on_message_received" });
    await user.triggers.listSubscriptions({ connectedAccountId: "ca_1" });

    expect((calls[0]!.body as Record<string, unknown>).userId).toBe("user_42");
    expect(calls[1]!.url).toBe(`${BASE}/saas/trigger-subscriptions?userId=user_42&connectedAccountId=ca_1`);
  });

  it("surfaces trigger_delivery_unavailable with its reason data", async () => {
    const { project } = projectRecorder(() =>
      fail("trigger_delivery_unavailable", 409, { data: { reason: "routed_webhook_unavailable", webhookIds: ["whk_1"] } }),
    );
    await expect(
      project.triggers.subscribe("user_42", { connectedAccountId: "ca_1", triggerId: "gmail.on_message_received" }),
    ).rejects.toMatchObject({
      code: "trigger_delivery_unavailable",
      status: 409,
      data: { reason: "routed_webhook_unavailable", webhookIds: ["whk_1"] },
    });
  });
});
