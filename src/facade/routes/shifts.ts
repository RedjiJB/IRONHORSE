// Shift assignment over the façade -- added alongside posts.ts so the
// certification-gating soft-flag path (DOMAIN-DESIGN.md §5) is actually
// reachable end-to-end, not just via MCP.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireSupervisor } from "../auth.js";
import { assignShift } from "../../domain/shifts.js";
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
}
