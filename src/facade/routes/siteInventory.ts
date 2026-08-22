// Task #156 slice E (site-inventory half). Maps consumables.ts (a flat,
// org-wide table -- no location concept, no movement-ledger history,
// just a single quantity_on_hand adjusted by signed delta) onto the
// vendored frontend's per-project, per-location stock ledger with a
// 4-type movement history (INBOUND/CONSUMPTION/WASTE/TRANSFER) -- exact
// field names confirmed by reading the frontend's own
// src/features/site-inventory/api.ts, not guessed.
//
// Every endpoint here is path-scoped by :projectId (confirmed by reading
// SiteInventoryPage.tsx: every query is `enabled: !!projectId`) -- this
// backend has no "projects" concept at all (Projects is one of the ~170
// modules with no FieldOps equivalent, explicitly not built). The
// :projectId segment is accepted so the route matches what the frontend
// actually calls, but its value is ignored entirely -- consumables stay
// a single flat, org-wide list, same as the domain layer underneath.
//
// Deliberately NOT built here (see docs/ARCHITECTURE.md Task #156 scope
// table): locations (no location concept exists to back even a
// synthetic "default" honestly -- returning a fake location a user
// didn't actually create would be worse than an isolated 404) and the
// movement ledger (no movement-history table exists; the one real write
// path -- adjusting quantity_on_hand -- already goes through the
// confirmation executor pattern via submit_consumable_adjustment, which
// requires a real crew_member id a dashboard admin doesn't have. Building
// a parallel direct-write path here would bypass that two-party-review
// design on purpose, which this slice does not do).
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { listConsumables, registerConsumable, type Consumable } from "../../domain/consumables.js";

function toFrontendItemShape(c: Consumable, projectId: string) {
  return {
    id: c.id,
    project_id: projectId,
    name: c.name,
    sku: null,
    unit: c.unit,
    boq_position_id: null,
    procurement_req_item_id: null,
    default_location_id: null,
    standard_unit_cost: null,
    currency: "USD",
    reorder_point: c.reorder_threshold,
    is_active: true,
    created_at: c.created_at,
    updated_at: c.created_at,
  };
}

type CreateItemBody = { name?: string; unit?: string; reorder_point?: string };

export function registerSiteInventoryRoutes(router: Router): void {
  router.get("/api/v1/site-inventory/projects/:projectId/items", async (req, res, { projectId }) => {
    try {
      await requireStaffRole(req);
      const items = await listConsumables();
      sendJson(res, 200, items.map((c) => toFrontendItemShape(c, projectId)));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/site-inventory/projects/:projectId/items", async (req, res, { projectId }) => {
    try {
      await requireStaffRole(req);
      const body = await readJsonBody<CreateItemBody>(req);
      if (!body.name) {
        sendJson(res, 422, { detail: "name is required" });
        return;
      }
      const consumable = await registerConsumable({
        name: body.name,
        unit: body.unit ?? "unit",
        stockingType: "stocked",
        reorderThreshold: body.reorder_point ? Number(body.reorder_point) : undefined,
      });
      sendJson(res, 200, toFrontendItemShape(consumable, projectId));
    } catch (err) {
      sendError(res, err);
    }
  });

  // Only 'stocked' consumables have a real quantity_on_hand --
  // 'per_job_delivery' ones don't track stock at all, so they're
  // excluded from this view rather than shown with a fabricated zero.
  router.get("/api/v1/site-inventory/projects/:projectId/stock-on-hand", async (req, res, { projectId }) => {
    try {
      await requireStaffRole(req);
      const items = await listConsumables({ stockingType: "stocked" });
      sendJson(res, 200, {
        project_id: projectId,
        location_id: null,
        item_count: items.length,
        rows: items.map((c) => ({ item_id: c.id, name: c.name, unit: c.unit, on_hand: c.quantity_on_hand ?? "0" })),
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
