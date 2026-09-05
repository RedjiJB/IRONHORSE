// Push-to-guard messaging/broadcast (FEATURES.md §3) over the façade.
// Sending/broadcasting is supervisor-only (requireSupervisor); reading
// your own inbox and marking your own messages read only needs a valid
// bearer token -- any guard, not just supervisors, has an inbox.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken, requireSupervisor } from "../auth.js";
import { broadcastToSite, listInbox, markMessageRead, sendMessage } from "../../domain/messages.js";

export function registerMessageRoutes(router: Router): void {
  router.post("/messages/send", async (req, res) => {
    try {
      const sender = await requireSupervisor(req);
      const body = await readJsonBody<{ recipientId?: string; body?: string }>(req);
      if (!body.recipientId || !body.body) {
        sendJson(res, 400, { detail: "recipientId and body are required" });
        return;
      }
      const message = await sendMessage({ senderId: sender.userId, recipientId: body.recipientId, body: body.body });
      sendJson(res, 200, { message });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/messages/broadcast", async (req, res) => {
    try {
      const sender = await requireSupervisor(req);
      const body = await readJsonBody<{ siteId?: string; body?: string }>(req);
      if (!body.siteId || !body.body) {
        sendJson(res, 400, { detail: "siteId and body are required" });
        return;
      }
      const messages = await broadcastToSite({ senderId: sender.userId, siteId: body.siteId, body: body.body });
      sendJson(res, 200, { sentCount: messages.length, messages });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/messages/inbox", async (req, res) => {
    try {
      const user = await requireBearerToken(req);
      const messages = await listInbox(user.userId);
      sendJson(res, 200, { messages });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/messages/:id/read", async (req, res, params) => {
    try {
      const user = await requireBearerToken(req);
      const result = await markMessageRead(params.id, user.userId);
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { message: result.message });
    } catch (err) {
      sendError(res, err);
    }
  });
}
