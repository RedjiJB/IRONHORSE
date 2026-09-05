// Shift handoff notes over the façade (FEATURES.md §2). Any authenticated
// guard can leave/acknowledge their own -- domain layer already enforces
// shift ownership/site match, same reasoning as patrols.ts.
import type { Router } from "../router.js";
import { getQueryParam, readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken } from "../auth.js";
import { acknowledgeHandoffNote, getHandoffNote, leaveHandoffNote, listHandoffNotes } from "../../domain/handoffNotes.js";

export function registerHandoffNoteRoutes(router: Router): void {
  router.post("/handoff-notes", async (req, res) => {
    try {
      const guard = await requireBearerToken(req);
      const body = await readJsonBody<{ siteId?: string; fromShiftId?: string; category?: string; body?: string }>(req);
      if (!body.siteId || !body.fromShiftId || !body.category || !body.body) {
        sendJson(res, 400, { detail: "siteId, fromShiftId, category, and body are required" });
        return;
      }
      const result = await leaveHandoffNote({
        siteId: body.siteId,
        fromShiftId: body.fromShiftId,
        authorGuardId: guard.userId,
        category: body.category,
        body: body.body,
      });
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { note: result.note });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/handoff-notes", async (req, res) => {
    try {
      await requireBearerToken(req);
      const siteId = getQueryParam(req, "siteId");
      const unacknowledgedOnly = getQueryParam(req, "unacknowledgedOnly") === "true";
      const notes = await listHandoffNotes({ siteId, unacknowledgedOnly });
      sendJson(res, 200, { notes });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/handoff-notes/:id", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const note = await getHandoffNote(params.id);
      if (!note) {
        sendJson(res, 404, { detail: "not_found" });
        return;
      }
      sendJson(res, 200, { note });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/handoff-notes/:id/acknowledge", async (req, res, params) => {
    try {
      const guard = await requireBearerToken(req);
      const body = await readJsonBody<{ shiftId?: string }>(req);
      if (!body.shiftId) {
        sendJson(res, 400, { detail: "shiftId is required" });
        return;
      }
      const result = await acknowledgeHandoffNote({ noteId: params.id, shiftId: body.shiftId, guardId: guard.userId });
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { note: result.note });
    } catch (err) {
      sendError(res, err);
    }
  });
}
