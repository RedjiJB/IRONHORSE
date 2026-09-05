// Weapon/equipment issue log over the façade (FEATURES.md §2). Registering
// and directly changing equipment status is supervisor-only; checking out
// and submitting a return only needs a valid token (any guard).
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireBearerToken, requireSupervisor } from "../auth.js";
import {
  checkOutEquipment,
  getEquipment,
  listEquipment,
  listEquipmentCheckouts,
  registerEquipment,
  setEquipmentStatus,
} from "../../domain/equipment.js";
import { submitForConfirmation } from "../../domain/confirmations.js";
import { getQueryParam } from "../context.js";

export function registerEquipmentRoutes(router: Router): void {
  router.post("/equipment", async (req, res) => {
    try {
      await requireSupervisor(req);
      const body = await readJsonBody<{ name?: string; category?: string; serialNumber?: string; siteId?: string }>(req);
      if (!body.name || !body.category) {
        sendJson(res, 400, { detail: "name and category are required" });
        return;
      }
      const equipment = await registerEquipment({ name: body.name, category: body.category, serialNumber: body.serialNumber, siteId: body.siteId });
      sendJson(res, 200, { equipment });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/equipment", async (req, res) => {
    try {
      await requireBearerToken(req);
      const status = getQueryParam(req, "status") as "available" | "checked_out" | "in_maintenance" | "missing" | "retired" | undefined;
      const category = getQueryParam(req, "category");
      const equipment = await listEquipment({ status, category });
      sendJson(res, 200, { equipment });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/equipment/:id", async (req, res, params) => {
    try {
      await requireBearerToken(req);
      const equipment = await getEquipment(params.id);
      if (!equipment) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      sendJson(res, 200, { equipment });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/equipment/:id/status", async (req, res, params) => {
    try {
      await requireSupervisor(req);
      const body = await readJsonBody<{ status?: "missing" | "in_maintenance" | "retired" }>(req);
      if (!body.status) {
        sendJson(res, 400, { detail: "status is required" });
        return;
      }
      const result = await setEquipmentStatus(params.id, body.status);
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { equipment: result.equipment });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/equipment/:id/checkout", async (req, res, params) => {
    try {
      const guard = await requireBearerToken(req);
      const body = await readJsonBody<{ guardId?: string; expectedReturnAt?: string }>(req);
      const result = await checkOutEquipment({ equipmentId: params.id, guardId: body.guardId ?? guard.userId, expectedReturnAt: body.expectedReturnAt });
      if (!result.ok) {
        sendJson(res, 409, { detail: result.reason });
        return;
      }
      sendJson(res, 200, { checkout: result.checkout });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/equipment-checkouts/:id/return", async (req, res, params) => {
    try {
      const guard = await requireBearerToken(req);
      const body = await readJsonBody<{ conditionFlag?: boolean; conditionNote?: string }>(req);
      const pending = await submitForConfirmation({
        actionType: "equipment_return",
        capability: "mcp:tool:submit_equipment_return",
        summary: `Equipment return for checkout ${params.id}${body.conditionFlag ? " (condition issue reported)" : ""}`,
        payload: { checkoutId: params.id, returnedByGuardId: guard.userId, conditionFlag: body.conditionFlag ?? false, conditionNote: body.conditionNote ?? null },
        submittedByGuardId: guard.userId,
      });
      sendJson(res, 200, { status: "awaiting_review", pendingConfirmationId: pending.id });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/equipment-checkouts", async (req, res) => {
    try {
      await requireBearerToken(req);
      const equipmentId = getQueryParam(req, "equipmentId");
      const outstandingParam = getQueryParam(req, "outstanding");
      const checkouts = await listEquipmentCheckouts({ equipmentId, outstanding: outstandingParam === "true" });
      sendJson(res, 200, { checkouts });
    } catch (err) {
      sendError(res, err);
    }
  });
}
