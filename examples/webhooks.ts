/**
 * Project webhook receiver — verify `x-oo-signature` on the raw body, then handle connection and
 * Trigger events. A Web-standard `Request` handler: mount it in Bun, Deno, Hono, Next.js, or Workers.
 *
 *   OOMOL_WEBHOOK_SECRET=whsec_... (wire `handleWebhook` into your server)
 */
import { ConnectorError, WEBHOOK_SIGNATURE_HEADER, parseWebhookEvent } from "@oomol-lab/connector";

const handled = new Set<string>();

export async function handleWebhook(request: Request): Promise<Response> {
  let event;
  try {
    event = await parseWebhookEvent({
      payload: await request.text(), // the raw body: verify before any JSON parsing
      signature: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
      secret: process.env.OOMOL_WEBHOOK_SECRET!,
    });
  } catch (err) {
    if (err instanceof ConnectorError && err.code === "client_invalid_signature") {
      return new Response("invalid signature", { status: 400 });
    }
    throw err;
  }

  // Retries keep the same id; store ids durably in production instead of in memory.
  if (handled.has(event.id)) return new Response(null, { status: 200 });
  handled.add(event.id);

  switch (event.type) {
    case "connection.succeeded":
      console.log("connected:", event.data.externalUserId, event.data.account.id);
      break;
    case "connection.failed":
      console.log("connection failed:", event.data.externalUserId, event.data.error?.code);
      break;
    case "trigger.message":
      console.log("trigger event:", event.data.triggerId, event.data.subscriptionId, event.data.payload);
      break;
    default:
      // New event types may be added later; acknowledge and ignore them.
      break;
  }
  return new Response(null, { status: 200 });
}
