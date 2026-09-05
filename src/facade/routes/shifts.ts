// Shift assignment over the façade -- added alongside posts.ts so the
// certification-gating soft-flag path (DOMAIN-DESIGN.md §5) is actually
// reachable end-to-end, not just via MCP.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireSupervisor } from "../auth.js";
import { assignShift, reassignShift } from "../../domain/shifts.js";
import { checkGuardPostCompliance } from "../../domain/certifications.js";

export function registerShiftRoutes(router: Router): void {
  router.post("/shifts", async (req, res) => {
    try {
      await requireSupervisor(req);
      const body = await readJsonBody<{
        guardId?: string;
        siteId?: string;
        date?: string;
        startTime?: string;
        endTime?: string;
        postId?: string;
      }>(req);
      if (!body.guardId || !body.siteId || !body.date) {
        sendJson(res, 400, { detail: "guardId, siteId, and date are required" });
        return;
      }
      const shift = await assignShift({
        guardId: body.guardId,
        siteId: body.siteId,
        date: body.date,
        startTime: body.startTime,
        endTime: body.endTime,
        postId: body.postId,
      });
      const complianceWarning = body.postId
        ? await checkGuardPostCompliance(body.guardId, body.postId, body.date)
        : null;
      sendJson(res, 200, { shift, complianceWarning });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/shifts/:id/reassign", async (req, res, params) => {
    try {
      await requireSupervisor(req);
      const body = await readJsonBody<{ newGuardId?: string; outgoingStatus?: "no_show" | "reassigned" }>(req);
      if (!body.newGuardId || !body.outgoingStatus) {
        sendJson(res, 400, { detail: "newGuardId and outgoingStatus are required" });
        return;
      }
      const result = await reassignShift({ shiftId: params.id, newGuardId: body.newGuardId, outgoingStatus: body.outgoingStatus });
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      const complianceWarning = result.newShift.post_id
        ? await checkGuardPostCompliance(body.newGuardId, result.newShift.post_id, result.newShift.date)
        : null;
      sendJson(res, 200, { oldShift: result.oldShift, newShift: result.newShift, complianceWarning });
    } catch (err) {
      sendError(res, err);
    }
  });
}
