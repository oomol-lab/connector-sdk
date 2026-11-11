/**
 * Hosted Trigger subscriptions for {@link ProjectConnector}: watch an end-user's connected account and
 * receive new provider events as signed `trigger.message` project webhooks (see `parseWebhookEvent`).
 *
 * Wire mapping: the gateway's subscription field `userId` is surfaced as `externalUserId`, matching the
 * rest of the project surface; every other field is passed through unchanged.
 */

import type { ProjectCallOptions, ProjectRequest } from "./project";

/** How a Trigger receives upstream events. Open union for forward compatibility. */
export type TriggerTransport = "poll" | "push" | (string & {});

/** A published Trigger from the catalog. */
export interface TriggerType {
  /** The Trigger id used when subscribing, e.g. `googlesheets.on_row_added`. */
  id: string;
  type: TriggerTransport;
  service: string;
  displayName: string;
  description: string;
  /** The definition version recorded on new subscriptions. */
  definitionVersion: number;
  /** JSON Schema for the subscription `config`, including defaults and required fields. */
  configSchema: Record<string, unknown>;
  /** JSON Schema for `data.payload` of delivered `trigger.message` events. */
  eventSchema: Record<string, unknown>;
  /** Polling interval used when `intervalSeconds` is omitted; `null` for push Triggers. */
  defaultIntervalSeconds: number | null;
  /** Shortest allowed polling interval; `null` for push Triggers. */
  minIntervalSeconds: number | null;
}

export type TriggerSubscriptionStatus = "active" | "paused" | "deleted" | (string & {});

/**
 * Why a subscription is paused. `checkpoint_reset_required` cannot be resumed — create a new
 * subscription instead.
 */
export type TriggerPauseReason =
  | "manual"
  | "checkpoint_reset_required"
  | "connection_unavailable"
  | "config_invalid"
  | "delivery_unavailable"
  | (string & {});

/**
 * Project billing admission for Triggers. `insufficient_credit` and `balance_unavailable` stop reads
 * and deliveries; `unverified` means the team balance has not been checked yet (the first subscribe
 * checks it) and does not block.
 */
export interface TriggerBilling {
  state: "allowed" | "insufficient_credit" | "balance_unavailable" | "unverified" | (string & {});
  checkedAt: number | null;
  nextCheckAt: number | null;
  blockedAt: number | null;
  /** When buffered events expire if the team stays in insufficient credit; otherwise `null`. */
  retentionUntil: number | null;
  buffer: { pending: number; maxPending: number };
  gap: { rejectedAttempts: number; expiredEvents: number; lastGapAt: number | null };
}

/** A subscription as returned in list pages (billing is reported once per page). */
export interface TriggerSubscriptionSummary {
  id: string;
  /** The end-user that owns the connected account (wire `userId`). */
  externalUserId: string;
  connectedAccountId: string;
  triggerId: string;
  /** The Trigger definition version this subscription is pinned to. */
  definitionVersion: number;
  config: Record<string, unknown>;
  status: TriggerSubscriptionStatus;
  pauseReason: TriggerPauseReason | null;
  pauseDetail: string | null;
  type: TriggerTransport;
  /** Push callback state; `null` for polling subscriptions. */
  push: { callbackUrl: string; setup: "automatic" | "application" | (string & {}); ready: boolean } | null;
  /** Polling state; `null` for push subscriptions. `initialized` turns true after the baseline read. */
  poll: { intervalSeconds: number; initialized: boolean; nextPollAt: number | null } | null;
  lastSuccessAt: number | null;
  lastError: { code: string; at: number | null } | null;
  consecutiveFailures: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

/** A single subscription, including the project's billing admission. */
export interface TriggerSubscription extends TriggerSubscriptionSummary {
  billing: TriggerBilling;
}

/** One page of subscriptions. */
export interface TriggerSubscriptionPage {
  data: TriggerSubscriptionSummary[];
  total: number;
  limit: number;
  offset: number;
  billing: TriggerBilling;
}

/** Input for `triggers.subscribe`. */
export interface SubscribeTriggerInput {
  /** The end-user's connected account the subscription reads. Cannot be changed later. */
  connectedAccountId: string;
  /** A Trigger id from the catalog. */
  triggerId: string;
  /** Matches the Trigger's `configSchema`. Cannot be changed later; subscribe again to watch something else. */
  config?: Record<string, unknown>;
  /** Polling Triggers only: read interval, at least `minIntervalSeconds`. */
  intervalSeconds?: number;
}

/** Options for `triggers.subscribe`. */
export interface SubscribeTriggerOptions extends ProjectCallOptions {
  /**
   * Sent as `Idempotency-Key`. A replay with the same key returns the original subscription instead
   * of creating another. When omitted the SDK generates one per call and reuses it across that call's
   * retries; pass your own stable key to also dedupe across process restarts.
   */
  idempotencyKey?: string;
}

/** Filters for `triggers.listSubscriptions`. */
export interface ListTriggerSubscriptionsQuery {
  externalUserId?: string;
  connectedAccountId?: string;
  status?: "active" | "paused" | "deleted";
  /** Page size, up to 100. Default 20. */
  limit?: number;
  offset?: number;
}

/** Changes for `triggers.updateSubscription`; at least one field is required. */
export interface UpdateTriggerSubscriptionInput {
  /** Polling Triggers only: new read interval. */
  intervalSeconds?: number;
  /** `paused` to pause, `active` to resume. */
  status?: "active" | "paused";
}

/** Options for `triggers.listTypes`. */
export interface ListTriggerTypesOptions extends ProjectCallOptions {
  /** Only return Triggers of this provider service. */
  service?: string;
}

/** Trigger catalog and subscription management. */
export interface ProjectTriggersApi {
  /** List published Triggers. The catalog is the same for every project. */
  listTypes(options?: ListTriggerTypesOptions): Promise<TriggerType[]>;
  /** Read one Trigger, including its config and event schemas. Unknown ids reject with `trigger_not_found`. */
  getType(triggerId: string, options?: ProjectCallOptions): Promise<TriggerType>;
  /**
   * Subscribe an end-user's connected account to a Trigger. Events arrive at your project webhooks as
   * `trigger.message`. Rejects with `trigger_delivery_unavailable` (409) when no active webhook would
   * receive them, `insufficient_credit` (402), or `balance_unavailable` (503).
   */
  subscribe(
    externalUserId: string,
    input: SubscribeTriggerInput,
    options?: SubscribeTriggerOptions,
  ): Promise<TriggerSubscription>;
  /** List subscriptions in the project, newest first. */
  listSubscriptions(query?: ListTriggerSubscriptionsQuery, options?: ProjectCallOptions): Promise<TriggerSubscriptionPage>;
  /** Read one subscription. Deleted subscriptions stay readable with `deletedAt` set. */
  getSubscription(subscriptionId: string, options?: ProjectCallOptions): Promise<TriggerSubscription>;
  /** Pause, resume, or change the polling interval. */
  updateSubscription(
    subscriptionId: string,
    input: UpdateTriggerSubscriptionInput,
    options?: ProjectCallOptions,
  ): Promise<TriggerSubscription>;
  /** Delete a subscription. Events recorded before deletion are still delivered. */
  deleteSubscription(subscriptionId: string, options?: ProjectCallOptions): Promise<TriggerSubscription>;
}

/** Trigger calls bound to the end-user from `forUser`. */
export interface ProjectUserTriggersApi {
  /** See {@link ProjectTriggersApi.subscribe}; the end-user is bound by `forUser`. */
  subscribe(input: SubscribeTriggerInput, options?: SubscribeTriggerOptions): Promise<TriggerSubscription>;
  /** See {@link ProjectTriggersApi.listSubscriptions}; filtered to the bound end-user. */
  listSubscriptions(
    query?: Omit<ListTriggerSubscriptionsQuery, "externalUserId">,
    options?: ProjectCallOptions,
  ): Promise<TriggerSubscriptionPage>;
}

/** Rename the wire `userId` to `externalUserId`; preserve every other gateway field. */
function toSubscription<T extends TriggerSubscriptionSummary>(data: unknown): T {
  const { userId, ...rest } = (data ?? {}) as Record<string, unknown>;
  return { ...rest, externalUserId: userId as string } as unknown as T;
}

function subscriptionPath(subscriptionId: string) {
  return `/saas/trigger-subscriptions/${encodeURIComponent(subscriptionId)}`;
}

function generatedIdempotencyKey(): string | undefined {
  return globalThis.crypto?.randomUUID?.();
}

export function createProjectTriggersApi(request: ProjectRequest): ProjectTriggersApi {
  return {
    listTypes: async (options = {}) => {
      const { service, ...callOptions } = options;
      const envelope = await request("GET", "/saas/trigger-types", { query: { service }, options: callOptions });
      return envelope.data as TriggerType[];
    },
    getType: async (triggerId, options) => {
      const envelope = await request("GET", `/saas/trigger-types/${encodeURIComponent(triggerId)}`, { options });
      return envelope.data as TriggerType;
    },
    subscribe: async (externalUserId, input, options = {}) => {
      const { idempotencyKey = generatedIdempotencyKey(), ...callOptions } = options;
      const envelope = await request("POST", "/saas/trigger-subscriptions", {
        body: {
          userId: externalUserId,
          connectedAccountId: input.connectedAccountId,
          triggerId: input.triggerId,
          ...(input.config === undefined ? {} : { config: input.config }),
          ...(input.intervalSeconds === undefined ? {} : { intervalSeconds: input.intervalSeconds }),
        },
        headers: idempotencyKey === undefined ? undefined : { "idempotency-key": idempotencyKey },
        options: callOptions,
      });
      return toSubscription<TriggerSubscription>(envelope.data);
    },
    listSubscriptions: async (query = {}, options) => {
      const envelope = await request("GET", "/saas/trigger-subscriptions", {
        query: {
          userId: query.externalUserId,
          connectedAccountId: query.connectedAccountId,
          status: query.status,
          limit: query.limit,
          offset: query.offset,
        },
        options,
      });
      const meta = (envelope.meta ?? {}) as Partial<Omit<TriggerSubscriptionPage, "data">>;
      return {
        data: ((envelope.data ?? []) as unknown[]).map((item) => toSubscription<TriggerSubscriptionSummary>(item)),
        total: meta.total ?? 0,
        limit: meta.limit ?? 0,
        offset: meta.offset ?? 0,
        billing: meta.billing as TriggerBilling,
      };
    },
    getSubscription: async (subscriptionId, options) => {
      const envelope = await request("GET", subscriptionPath(subscriptionId), { options });
      return toSubscription<TriggerSubscription>(envelope.data);
    },
    updateSubscription: async (subscriptionId, input, options) => {
      const envelope = await request("PATCH", subscriptionPath(subscriptionId), {
        body: {
          ...(input.intervalSeconds === undefined ? {} : { intervalSeconds: input.intervalSeconds }),
          ...(input.status === undefined ? {} : { status: input.status }),
        },
        options,
      });
      return toSubscription<TriggerSubscription>(envelope.data);
    },
    deleteSubscription: async (subscriptionId, options) => {
      const envelope = await request("DELETE", subscriptionPath(subscriptionId), { options });
      return toSubscription<TriggerSubscription>(envelope.data);
    },
  };
}

export function bindProjectUserTriggers(triggers: ProjectTriggersApi, externalUserId: string): ProjectUserTriggersApi {
  return {
    subscribe: (input, options) => triggers.subscribe(externalUserId, input, options),
    listSubscriptions: (query, options) => triggers.listSubscriptions({ ...query, externalUserId }, options),
  };
}
