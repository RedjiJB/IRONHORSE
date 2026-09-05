// Incident reporting + duress alerts over the façade (FEATURES.md §2/§4,
// DOMAIN-DESIGN.md §2/§3). Reporting/actions/duress all need only a valid
// token (any guard can report an incident or trigger duress about
// themselves) -- reviewing/escalating is not restricted to supervisors
// here the way approve_pending_confirmation is, since FEATURES.md §4's
// "remote incident escalation" doesn't specify supervisor-only the way
// §3's approve/reject queue explicitly does. Tightening this to
// supervisor-only is a reasonable follow-up if that turns out wrong.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken } from "../auth.js";
import {
  addIncidentAction,
  getCurrentSeverity,
  getIncident,
  listIncidentActions,
  listIncidents,
  reportIncident,
} from "../../domain/incidents.js";
import { triggerDuressAlert } from "../../domain/duress.js";
import { getQueryParam } from "../context.js";

export function registerIncidentRoutes(router: Router): void {
  router.post("/incidents", async (req, res) => {
    try {
      await requireBearerToken(req);
      const body = await readJsonBody<{
        siteId?: string;
        reportedByGuardId?: string;
        category?: string;
        severity?: "low" | "medium" | "high" | "critical";
        summary?: string;
        lat?: number;
        lng?: number;
      }>(req);
      if (!body.siteId || !body.reportedByGuardId || !body.category || !body.severity || !body.summary) {
        sendJson(res, 400, { detail: "siteId, reportedByGuardId, category, severity, and summary are required" });
        return;
      }
      const incident = await reportIncident({
        siteId: body.siteId,
        reportedByGuardId: body.reportedByGuardId,
        category: body.category,
        severity: body.severity,
        summary: body.summary,
        lat: body.lat,
        lng: body.lng,
      });
      sendJson(res, 200, { incident });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/incidents", async (req, res) => {
    try {
      await requireBearerToken(req);
      const siteId = getQueryParam(req, "siteId");
      const status = getQueryParam(req, "status") as "open" | "escalated" | "resolved" | undefined;
      const incidents = await listIncidents({ siteId, status });
      sendJson(res, 200, { incidents });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/incidents/:id", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const incident = await getIncident(params.id);
      if (!incident) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      const currentSeverity = await getCurrentSeverity(params.id);
      const actions = await listIncidentActions(params.id);
      sendJson(res, 200, { incident: { ...incident, currentSeverity }, actions });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/incidents/:id/actions", async (req, res, params) => {
    try {
      const actor = await requireBearerToken(req);
      const body = await readJsonBody<{
        actionType?: "escalated" | "reassigned" | "note_added" | "resolved";
        note?: string;
        newSeverity?: "low" | "medium" | "high" | "critical";
      }>(req);
      if (!body.actionType) {
        sendJson(res, 400, { detail: "actionType is required" });
        return;
      }
      const action = await addIncidentAction({
        incidentId: params.id,
        actorGuardId: actor.userId,
        actionType: body.actionType,
        note: body.note,
        newSeverity: body.newSeverity,
      });
      sendJson(res, 200, { action });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/duress/trigger", async (req, res) => {
    try {
      const guard = await requireBearerToken(req);
      const body = await readJsonBody<{ siteId?: string; lat?: number; lng?: number }>(req);
      if (!body.siteId || body.lat == null || body.lng == null) {
        sendJson(res, 400, { detail: "siteId, lat, and lng are required" });
        return;
      }
      const result = await triggerDuressAlert({ guardId: guard.userId, siteId: body.siteId, lat: body.lat, lng: body.lng });
      sendJson(res, 200, result);
    } catch (err) {
      sendError(res, err);
    }
  });
}
