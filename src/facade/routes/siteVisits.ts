// Site visit / spot-check logging over the façade (FEATURES.md §3).
// Logging a visit is supervisor-only (it's the supervisor's own presence
// being recorded); listing is open to any authenticated caller, same as
// patrol-run/checkpoint-scan visibility.
import type { Router } from "../router.js";
import { getQueryParam, readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken, requireSupervisor } from "../auth.js";
import { getSiteVisit, listSiteVisits, logSiteVisit } from "../../domain/siteVisits.js";

export function registerSiteVisitRoutes(router: Router): void {
  router.post("/site-visits", async (req, res) => {
    try {
      const supervisor = await requireSupervisor(req);
      const body = await readJsonBody<{ siteId?: string; lat?: number; lng?: number; note?: string }>(req);
      if (!body.siteId) {
        sendJson(res, 400, { detail: "siteId is required" });
        return;
      }
      const visit = await logSiteVisit({
        supervisorGuardId: supervisor.userId,
        siteId: body.siteId,
        lat: body.lat,
        lng: body.lng,
        note: body.note,
      });
      sendJson(res, 200, { visit });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/site-visits", async (req, res) => {
    try {
      await requireBearerToken(req);
      const siteId = getQueryParam(req, "siteId");
      const supervisorGuardId = getQueryParam(req, "supervisorGuardId");
      const visits = await listSiteVisits({ siteId, supervisorGuardId });
      sendJson(res, 200, { visits });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/site-visits/:id", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const visit = await getSiteVisit(params.id);
      if (!visit) {
        sendJson(res, 404, { detail: "not_found" });
        return;
      }
      sendJson(res, 200, { visit });
    } catch (err) {
      sendError(res, err);
    }
  });
}
