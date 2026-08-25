// Task #156 slice E (procurement half). Maps purchaseOrders.ts/vendors.ts
// onto the vendored frontend's construction-billing-shaped PO model --
// exact field/status names confirmed by reading the frontend's own
// ProcurementPage.tsx and POStatusPipeline.tsx, not guessed.
//
// Real structural mismatch, not glossed over: the frontend's "New PO"
// form lets a user type ad-hoc line items directly (description/qty/
// rate), with no order to compile from -- but this backend's only
// existing creation path, compilePurchaseOrder, requires a pre-existing
// order with real asset/consumable-linked order_items. Rather than force
// every dashboard-created PO through a synthetic order + fake catalog
// items, createFreeformPurchaseOrder (src/domain/purchaseOrders.ts) is a
// small, honest second creation path the schema already allowed (order_id
// and order_item_id were already nullable) -- a PO not derived from a
// crew-submitted request, e.g. an admin ordering supplies directly.
//
// Status vocabulary is genuinely different between the two systems and
// mapped, not aliased 1:1: compiled->draft, sent_to_office/
// forwarded_by_office->issued, fulfilled->completed, cancelled->cancelled.
// The frontend's separate 'approved' pipeline stage has no backing state
// in this domain (no gate exists between "compiled" and "sent") --
// approve is accepted and returns success (matching the plan's "no-op
// pass-through" scope decision) but does not advance status, so the
// pipeline will still show 'draft' immediately after approving an
// unissued PO. This is a known, deliberate limitation, not a bug.
//
// Deliberately NOT built here (see docs/ARCHITECTURE.md Task #156 scope
// table): 3-way-match, goods receipts, supplier scorecards, vendor
// prequalification, retainage, tax computation, PO edit (PATCH) -- no
// domain backing exists for any of these. The finance dashboard stub
// below exists only because ProcurementPage.tsx calls it unconditionally
// alongside the PO list; it is not a finance module.
import type { Router } from "../router.js";
import { getQueryParam, readJsonBody, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import {
  createFreeformPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrderItems,
  listPurchaseOrders,
  sendPurchaseOrder,
  type PoStatus,
  type PurchaseOrder,
} from "../../domain/purchaseOrders.js";
import { getVendor } from "../../domain/vendors.js";

const STATUS_MAP: Record<PoStatus, string> = {
  compiled: "draft",
  sent_to_office: "issued",
  forwarded_by_office: "issued",
  fulfilled: "completed",
  cancelled: "cancelled",
};

async function toFrontendShape(po: PurchaseOrder, projectId: string) {
  const vendor = po.vendor_id ? await getVendor(po.vendor_id) : null;
  return {
    id: po.id,
    project_id: projectId,
    po_number: `PO-${po.id.slice(0, 8).toUpperCase()}`,
    vendor_name: vendor?.name ?? "",
    vendor_contact_id: po.vendor_id,
    issue_date: po.created_at,
    delivery_date: po.eta,
    amount_total: po.cost ?? "0",
    currency_code: "USD",
    status: STATUS_MAP[po.status],
    description: "",
    line_items_count: (await listPurchaseOrderItems(po.id)).length,
    created_at: po.created_at,
    updated_at: po.created_at,
  };
}

type CreatePOBody = {
  project_id?: string;
  vendor_contact_id?: string;
  amount_total?: string;
  items?: { description: string; quantity?: string }[];
};

export function registerProcurementRoutes(router: Router): void {
  router.get("/api/v1/procurement", async (req, res) => {
    try {
      await requireStaffRole(req);
      const projectId = getQueryParam(req, "project_id") ?? "";
      const purchaseOrders = await listPurchaseOrders();
      const items = await Promise.all(purchaseOrders.map((po) => toFrontendShape(po, projectId)));
      sendJson(res, 200, { items, total: items.length, offset: 0, limit: items.length });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/procurement/:id", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const po = await getPurchaseOrder(id);
      if (!po) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      const vendor = po.vendor_id ? await getVendor(po.vendor_id) : null;
      const items = await listPurchaseOrderItems(id);
      sendJson(res, 200, {
        id: po.id,
        vendor_contact_id: po.vendor_id,
        vendor_name: vendor?.name ?? null,
        po_number: `PO-${po.id.slice(0, 8).toUpperCase()}`,
        po_type: null,
        issue_date: po.created_at,
        delivery_date: po.eta,
        currency_code: "USD",
        amount_subtotal: po.cost ?? "0",
        tax_amount: "0",
        amount_total: po.cost ?? "0",
        status: STATUS_MAP[po.status],
        payment_terms: null,
        notes: null,
        items: items.map((item, index) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity ?? "1",
          unit: null,
          unit_rate: "0",
          amount: "0",
          sort_order: index,
        })),
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/procurement", async (req, res) => {
    try {
      await requireStaffRole(req);
      const body = await readJsonBody<CreatePOBody>(req);
      const items = (body.items ?? []).filter((i) => i.description?.trim());
      if (items.length === 0) {
        sendJson(res, 422, { detail: "Add at least one item" });
        return;
      }
      let cost: number | undefined;
      if (body.amount_total != null && body.amount_total !== "") {
        cost = Number(body.amount_total);
        if (!Number.isFinite(cost)) {
          sendJson(res, 422, { detail: "amount_total must be a valid number" });
          return;
        }
      }
      const parsedItems: { description: string; quantity?: number }[] = [];
      for (const i of items) {
        let quantity: number | undefined;
        if (i.quantity != null && i.quantity !== "") {
          quantity = Number(i.quantity);
          if (!Number.isFinite(quantity)) {
            sendJson(res, 422, { detail: "item quantity must be a valid number" });
            return;
          }
        }
        parsedItems.push({ description: i.description, quantity });
      }
      await createFreeformPurchaseOrder({
        vendorId: body.vendor_contact_id,
        cost,
        items: parsedItems,
      });
      sendJson(res, 200, { vendor_warnings: [] satisfies string[] });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/procurement/:id/issue", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const result = await sendPurchaseOrder(id, "dashboard");
      if (!result.ok) {
        sendJson(res, 400, { detail: result.reason });
        return;
      }
      sendJson(res, 200, {});
    } catch (err) {
      sendError(res, err);
    }
  });

  // No separate "approved" gate exists in this domain between compiled
  // and sent -- accepted for the frontend's pipeline UI, but does not
  // advance status. See the file header comment.
  router.post("/api/v1/procurement/:id/approve", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const po = await getPurchaseOrder(id);
      if (!po) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      sendJson(res, 200, {});
    } catch (err) {
      sendError(res, err);
    }
  });

  // Not a finance module -- ProcurementPage.tsx calls this unconditionally
  // alongside the PO list; a fixed currency keeps that one query from
  // erroring without pretending a Finance feature exists.
  router.get("/api/v1/finance/dashboard", async (req, res) => {
    try {
      await requireStaffRole(req);
      sendJson(res, 200, { currency: "USD" });
    } catch (err) {
      sendError(res, err);
    }
  });
}
