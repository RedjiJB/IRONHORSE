// Read-only chat assistant façade route. See src/domain/chat.ts's file
// header for the full read-only/agentic-scope rationale.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { runChatTurn, type ChatMessage } from "../../domain/chat.js";

type ChatRequestBody = {
  message?: string;
  history?: ChatMessage[];
};

export function registerChatRoutes(router: Router): void {
  router.post("/api/v1/chat", async (req, res) => {
    try {
      await requireStaffRole(req);
      const body = await readJsonBody<ChatRequestBody>(req);
      if (!body.message || typeof body.message !== "string" || !body.message.trim()) {
        sendJson(res, 422, { detail: "message is required" });
        return;
      }
      const result = await runChatTurn(body.message, body.history ?? []);
      sendJson(res, 200, result);
    } catch (err) {
      // No LLM provider has a configured key yet -- a real, expected state
      // right now (not a bug), so it gets its own clear response instead
      // of a raw 500 the frontend would show as "something went wrong."
      if (err instanceof Error && err.message.startsWith("No configured LLM provider succeeded")) {
        sendJson(res, 503, { detail: "The chat assistant has no LLM provider configured yet." });
        return;
      }
      sendError(res, err);
    }
  });
}
