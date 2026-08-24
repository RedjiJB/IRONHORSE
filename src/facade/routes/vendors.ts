// Restoring the Procurement page's dead "Supplier Catalogs" cross-link:
// investigation found no catalog concept (per-vendor SKUs/pricing) exists
// in this domain, but vendors.ts itself is real (name, contact info,
// lead time), and per-vendor purchase-order totals are the same
// aggregation kpis.ts's PO-spend-by-vendor already does. A real,
// bounded v1 -- a vendor directory with what's actually been ordered
// from each one -- not a catalog/pricing feature that has nothing to
// back it. Renamed to "Vendors" in the UI rather than kept as
// "Supplier Catalogs", same honesty call as 5D Cost -> Site Cost Summary.
import type { Router } from "../router.js";
import { sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { listVendors } from "../../domain/vendors.js";
import { listPurchaseOrders } from "../../domain/purchaseOrders.js";

export function registerVendorRoutes(router: Router): void {
  router.get("/api/v1/vendors", async (req, res) => {
    try {
      await requireStaffRole(req);
      const [vendors, purchaseOrders] = await Promise.all([listVendors(), listPurchaseOrders()]);
      const items = vendors.map((v) => {
        const vendorPos = purchaseOrders.filter((po) => po.vendor_id === v.id);
        const totalSpend = vendorPos.reduce((sum, po) => sum + (po.cost ? Number(po.cost) : 0), 0);
        return {
          id: v.id,
          name: v.name,
          contact_method: v.contact_method,
          contact_address: v.contact_address,
          account_number: v.account_number,
          lead_time_days: v.lead_time_days,
          po_count: vendorPos.length,
          total_spend: totalSpend,
        };
      });
      sendJson(res, 200, { items });
    } catch (err) {
      sendError(res, err);
    }
  });
}
