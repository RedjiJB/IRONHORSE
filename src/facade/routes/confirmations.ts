// The supervisor approve/reject queue (FEATURES.md §3) -- near-zero new
// backend, per ROADMAP.md's Phase 1 note: this just exposes
// confirmations.ts's existing submit/list/approve/reject through the
// façade so the mobile/web supervisor UI can reach it over HTTP instead of
// MCP. The reviewer is always the authenticated caller (req's own userId),
// never a value the client supplies, matching approveConfirmation's
// existing capability re-check on that same id.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireSupervisor } from "../auth.js";
import { approveConfirmation, listPendingConfirmations, rejectConfirmation } from "../../domain/confirmations.js";

export function registerConfirmationRoutes(router: Router): void {
  router.get("/confirmations/pending", async (req, res) => {
    try {
      await requireSupervisor(req);
      const pending = await listPendingConfirmations();
      sendJson(res, 200, { pending });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/confirmations/:id/approve", async (req, res, params) => {
    try {
      const reviewer = await requireSupervisor(req);
      const body = await readJsonBody<{ approvalData?: Record<string, unknown> }>(req);
      const result = await approveConfirmation(params.id, reviewer.userId, body.approvalData);
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { confirmation: result.confirmation });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/confirmations/:id/reject", async (req, res, params) => {
    try {
      const reviewer = await requireSupervisor(req);
      const body = await readJsonBody<{ note?: string }>(req);
      const result = await rejectConfirmation(params.id, reviewer.userId, body.note);
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { confirmation: result.confirmation });
    } catch (err) {
      sendError(res, err);
    }
  });
}
