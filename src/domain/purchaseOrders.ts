// Re-expressed from v1's purchase_orders/purchase_order_items domain
// logic -- requirements baseline, not copied code. Compiled from an
// order's order_items; deliberately no vendor API integration, same as
// v1 -- a PO only ever routes information to a human.
//
// Deviation from v1: v1 records the *approving reviewer* as fulfilled_by
// on the confirm-before-execute path (a manager's approval act is what's
// credited, not the crew member's original delivery-receipt claim). This
// system's confirmation executor signature only ever receives the
// submitted payload, consistently across every confirmable action type
// (see src/domain/confirmations.ts) -- so fulfilled_by here records who
// submitted the claim, same convention as checkout_return/
// asset_verification. "Who actually approved it" isn't lost -- it's on
// pending_confirmations.reviewed_by, not duplicated onto this row.
import { pool } from "../db/pool.js";
import { registerConfirmationExecutor } from "./confirmations.js";

export type PoStatus = "compiled" | "sent_to_office" | "forwarded_by_office" | "fulfilled" | "cancelled";

// Exported and reused by the confirmation executor below so the
// precondition can't drift between call sites, same reasoning v1 gave for
// exporting this constant.
export const PO_FULFILLABLE_STATUSES: PoStatus[] = ["sent_to_office", "forwarded_by_office"];

export type PurchaseOrder = {
  id: string;
  vendor_id: string | null;
  order_id: string | null;
  status: PoStatus;
  cost: string | null;
  eta: string | null;
  sent_to: string | null;
  created_at: string;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
};

export type PurchaseOrderItem = {
  id: string;
  purchase_order_id: string;
  description: string;
  quantity: string | null;
  order_item_id: string | null;
};

export type CompilePurchaseOrderResult =
  | { ok: true; purchaseOrder: PurchaseOrder }
  | { ok: false; reason: "order_not_found" | "no_items" };

export async function compilePurchaseOrder(orderId: string, vendorId?: string): Promise<CompilePurchaseOrderResult> {
  const order = await pool.query("SELECT id FROM orders WHERE id = $1", [orderId]);
  if (!order.rows[0]) return { ok: false, reason: "order_not_found" };

  const items = await pool.query(
    `SELECT oi.id, oi.quantity, a.name AS asset_name, c.name AS consumable_name
     FROM order_items oi
     LEFT JOIN assets a ON a.id = oi.asset_id
     LEFT JOIN consumables c ON c.id = oi.consumable_id
     WHERE oi.order_id = $1`,
    [orderId],
  );
  if (items.rowCount === 0) return { ok: false, reason: "no_items" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const poRow = await client.query(
      `INSERT INTO purchase_orders (vendor_id, order_id) VALUES ($1, $2) RETURNING *`,
      [vendorId ?? null, orderId],
    );
    const purchaseOrderId = poRow.rows[0].id as string;
    for (const item of items.rows) {
      const itemName = item.asset_name ?? item.consumable_name ?? "item";
      await client.query(
        `INSERT INTO purchase_order_items (purchase_order_id, description, quantity, order_item_id)
         VALUES ($1, $2, $3, $4)`,
        [purchaseOrderId, `${itemName} x ${item.quantity}`, item.quantity, item.id],
      );
    }
    await client.query("COMMIT");
    return { ok: true, purchaseOrder: poRow.rows[0] as PurchaseOrder };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type SendPurchaseOrderResult =
  | { ok: true; purchaseOrder: PurchaseOrder }
  | { ok: false; reason: "not_found" | "not_compiled" };

export async function sendPurchaseOrder(id: string, sentTo: string): Promise<SendPurchaseOrderResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM purchase_orders WHERE id = $1 FOR UPDATE", [id]);
    const po = current.rows[0] as PurchaseOrder | undefined;
    if (!po) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (po.status !== "compiled") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_compiled" };
    }
    const updated = await client.query(
      "UPDATE purchase_orders SET status = 'sent_to_office', sent_to = $2 WHERE id = $1 RETURNING *",
      [id, sentTo],
    );
    await client.query("COMMIT");
    return { ok: true, purchaseOrder: updated.rows[0] as PurchaseOrder };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listPurchaseOrders(filter?: { status?: PoStatus }): Promise<PurchaseOrder[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM purchase_orders ${where} ORDER BY created_at DESC`, params);
  return result.rows as PurchaseOrder[];
}

export async function getPurchaseOrder(id: string): Promise<PurchaseOrder | null> {
  const result = await pool.query("SELECT * FROM purchase_orders WHERE id = $1", [id]);
  return (result.rows[0] as PurchaseOrder) ?? null;
}

export async function listPurchaseOrderItems(purchaseOrderId: string): Promise<PurchaseOrderItem[]> {
  const result = await pool.query("SELECT * FROM purchase_order_items WHERE purchase_order_id = $1", [purchaseOrderId]);
  return result.rows as PurchaseOrderItem[];
}

// Registered once at server startup (see src/mcp/tools/purchaseOrders.ts).
// A crew member's own "it arrived" claim isn't independent verification
// of anything -- same reasoning as every other confirmable action here.
export function registerPurchaseOrderFulfillmentExecutor(): void {
  registerConfirmationExecutor("purchase_order_fulfillment", async (payload) => {
    const purchaseOrderId = payload.purchaseOrderId as string;
    const crewMemberId = payload.crewMemberId as string;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT status FROM purchase_orders WHERE id = $1 FOR UPDATE", [purchaseOrderId]);
      const po = current.rows[0] as { status: PoStatus } | undefined;
      if (!po) throw new Error("purchase_order_fulfillment failed: not_found");
      if (!PO_FULFILLABLE_STATUSES.includes(po.status)) {
        throw new Error(`purchase_order_fulfillment failed: not_fulfillable (status=${po.status})`);
      }
      const updated = await client.query(
        `UPDATE purchase_orders SET status = 'fulfilled', fulfilled_at = now(), fulfilled_by = $2
         WHERE id = $1 RETURNING id`,
        [purchaseOrderId, crewMemberId],
      );
      await client.query("COMMIT");
      return { resultId: updated.rows[0].id as string };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });
}
