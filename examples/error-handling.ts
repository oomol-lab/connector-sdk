/**
 * Error handling — every failure throws a typed `ConnectorError`; caller cancellation rejects
 * with the standard `AbortError`.
 *
 *   OOMOL_API_KEY=api_... bun run examples/error-handling.ts
 */
import { Connector, ConnectorError, isRetryable } from "@oomol-lab/connector";
import type { ConnectorErrorCode } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });

async function main() {
  try {
    await oomol.slack.post_message({ channel: "#general", text: "shipped" });
  } catch (err) {
    if (err instanceof ConnectorError) {
      // Discriminate on `code` (open union: known backend codes get completion, unknown ones pass through).
      const code: ConnectorErrorCode = err.code;
      console.error(`[${code}] ${err.message}`);
      console.error("status:", err.status);          // HTTP status (0 for client/network errors)
      console.error("actionId:", err.actionId);       // when applicable
      console.error("executionId:", err.executionId); // when applicable
      console.error("requestId:", err.requestId);     // failure-correlation id
      console.error("data:", err.data);               // upstream body on provider_error
      console.error("retryable:", isRetryable(err));  // 429 / 5xx / network / rate_limited / ...

      switch (err.code) {
        case "credential_expired":
        case "scope_missing":
          console.error("→ reconnect the provider in the dashboard");
          break;
        case "rate_limited":
          console.error("→ back off and retry later");
          break;
        case "client_timeout":       // exceeded the client-side timeoutMs
        case "client_network_error": // DNS / connection / fetch threw
        case "client_invalid_request": // local precheck (e.g. illegal header) — no request sent
          console.error("→ client-side issue");
          break;
        default:
          console.error("→ unhandled code");
      }
    } else {
      throw err; // not a ConnectorError (e.g. AbortError from caller cancellation) — rethrow
    }
  }
}

void main();
