// Patrols/checkpoints over the façade (FEATURES.md §2, DOMAIN-DESIGN.md
// §1). Any authenticated guard can start/scan their own patrol -- domain
// layer already enforces the shift ownership/site match, so no
// supervisor-only gate is needed here the way approve/reject and
// broadcast have.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken } from "../auth.js";
import { createPatrolRoute, listPatrolRoutes, startPatrolRun, completePatrolRun, abandonPatrolRun, listPatrolRuns } from "../../domain/patrols.js";
import { createCheckpoint, listCheckpoints, scanCheckpoint, listCheckpointScans } from "../../domain/checkpoints.js";
import { getQueryParam } from "../context.js";

export function registerPatrolRoutes(router: Router): void {
  router.post("/patrol-routes", async (req, res) => {
    try {
      await requireBearerToken(req);
      const body = await readJsonBody<{ siteId?: string; name?: string }>(req);
      if (!body.siteId || !body.name) {
        sendJson(res, 400, { detail: "siteId and name are required" });
        return;
      }
      const route = await createPatrolRoute({ siteId: body.siteId, name: body.name });
      sendJson(res, 200, { route });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/patrol-routes", async (req, res) => {
    try {
      await requireBearerToken(req);
      const siteId = getQueryParam(req, "siteId");
      const routes = await listPatrolRoutes({ siteId });
      sendJson(res, 200, { routes });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/patrol-routes/:id/checkpoints", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const body = await readJsonBody<{
        sequence?: number;
        label?: string;
        verificationMethod?: "qr" | "nfc" | "gps";
        qrOrNfcToken?: string;
        lat?: number;
        lng?: number;
        radiusM?: number;
      }>(req);
      if (body.sequence == null || !body.label || !body.verificationMethod) {
        sendJson(res, 400, { detail: "sequence, label, and verificationMethod are required" });
        return;
      }
      const checkpoint = await createCheckpoint({ patrolRouteId: params.id, ...body, sequence: body.sequence, label: body.label, verificationMethod: body.verificationMethod });
      sendJson(res, 200, { checkpoint });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/patrol-routes/:id/checkpoints", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const checkpoints = await listCheckpoints(params.id);
      sendJson(res, 200, { checkpoints });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/patrol-runs", async (req, res) => {
    try {
      const guard = await requireBearerToken(req);
      const body = await readJsonBody<{ patrolRouteId?: string; shiftId?: string }>(req);
      if (!body.patrolRouteId || !body.shiftId) {
        sendJson(res, 400, { detail: "patrolRouteId and shiftId are required" });
        return;
      }
      const result = await startPatrolRun({ patrolRouteId: body.patrolRouteId, guardId: guard.userId, shiftId: body.shiftId });
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { run: result.run });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/patrol-runs", async (req, res) => {
    try {
      await requireBearerToken(req);
      const guardId = getQueryParam(req, "guardId");
      const status = getQueryParam(req, "status") as "in_progress" | "completed" | "abandoned" | undefined;
      const runs = await listPatrolRuns({ guardId, status });
      sendJson(res, 200, { runs });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/patrol-runs/:id/complete", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const run = await completePatrolRun(params.id);
      if (!run) {
        sendJson(res, 409, { detail: "Not found or not in progress" });
        return;
      }
      sendJson(res, 200, { run });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/patrol-runs/:id/abandon", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const run = await abandonPatrolRun(params.id);
      if (!run) {
        sendJson(res, 409, { detail: "Not found or not in progress" });
        return;
      }
      sendJson(res, 200, { run });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/patrol-runs/:id/scan", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const body = await readJsonBody<{ checkpointId?: string; submittedToken?: string; lat?: number; lng?: number; exceptionNote?: string }>(req);
      if (!body.checkpointId) {
        sendJson(res, 400, { detail: "checkpointId is required" });
        return;
      }
      const result = await scanCheckpoint({ patrolRunId: params.id, ...body, checkpointId: body.checkpointId });
      if (!result.ok) {
        sendJson(res, 404, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { scan: result.scan });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/patrol-runs/:id/scans", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const scans = await listCheckpointScans(params.id);
      sendJson(res, 200, { scans });
    } catch (err) {
      sendError(res, err);
    }
  });
}
