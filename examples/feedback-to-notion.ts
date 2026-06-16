/**
 * Scenario — turn a feedback endpoint into a Notion inbox.
 *
 * `POST /feedback` with `{ email?, message }` → one `append_block` call → the note lands as a
 * new paragraph at the bottom of your Notion page. No Notion SDK, no OAuth dance, no block JSON.
 *
 *   OOMOL_API_KEY=api_... NOTION_FEEDBACK_PAGE_ID=<page-id> bun run examples/feedback-to-notion.ts
 *   curl -X POST localhost:3000/feedback -d '{"email":"alice@acme.com","message":"Love it!"}'
 *
 * For precise input/output types + JSDoc on `notion.*`, install `@oomol-lab/connector-types`
 * and add `import "@oomol-lab/connector-types/notion";`. Without it the call stays loosely typed.
 */
import { Connector } from "@oomol-lab/connector";

const oomol = new Connector({ apiKey: process.env.OOMOL_API_KEY! });
const FEEDBACK_PAGE_ID = process.env.NOTION_FEEDBACK_PAGE_ID!;

const server = Bun.serve({
  port: 3000,
  routes: {
    "/feedback": {
      POST: async (req) => {
        const { email, message } = await req.json().catch(() => ({}));
        if (!message) return Response.json({ error: "message is required" }, { status: 400 });

        await oomol.notion.append_block({
          pageId: FEEDBACK_PAGE_ID,
          text: `${email ?? "anonymous"} — ${message}`,
        });

        return Response.json({ ok: true });
      },
    },
  },
});

console.log(`feedback inbox listening on ${server.url}`);
