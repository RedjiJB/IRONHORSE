// Lone-worker check-in timer over the façade (FEATURES.md §2). Checking
// in is any authenticated guard against their own shift -- domain layer
// enforces ownership, same reasoning as patrols.ts. Listing the overdue
// queue is supervisor-only, same convention as certifications.ts's
// compliance routes.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson, getQueryParam } from "../context.js";
import { requireBearerToken, requireSupervisor } from "../auth.js";
import { checkIn, listCheckins, listOverdueLoneWorkers } from "../../domain/loneWorker.js";

export function registerLoneWorkerRoutes(router: Router): void {
  router.post("/lone-worker/checkins", async (req, res) => {
    try {
      const guard = await requireBearerToken(req);
      const body = await readJsonBody<{ shiftId?: string; intervalMinutes?: number; lat?: number; lng?: number }>(req);
      if (!body.shiftId || !body.intervalMinutes) {
        sendJson(res, 400, { detail: "shiftId and intervalMinutes are required" });
        return;
      }
      const result = await checkIn({
        shiftId: body.shiftId,
        guardId: guard.userId,
        intervalMinutes: body.intervalMinutes,
        lat: body.lat,
        lng: body.lng,
      });
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { checkin: result.checkin });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/lone-worker/checkins", async (req, res) => {
    try {
      await requireBearerToken(req);
      const shiftId = getQueryParam(req, "shiftId");
      const guardId = getQueryParam(req, "guardId");
      const checkins = await listCheckins({ shiftId, guardId });
      sendJson(res, 200, { checkins });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/lone-worker/overdue", async (req, res) => {
    try {
      await requireSupervisor(req);
      const overdue = await listOverdueLoneWorkers();
      sendJson(res, 200, { overdue });
    } catch (err) {
      sendError(res, err);
    }
  });
}
