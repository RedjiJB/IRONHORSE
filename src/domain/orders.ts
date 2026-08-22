// Re-expressed from v1's orders/order_items domain logic -- requirements
// baseline, not copied code. A crew request for equipment/materials,
// tracked through a fulfillment pipeline distinct from purchasing (see
// purchaseOrders.ts). Status only ever advances forward through
// ORDER_FORWARD_SEQUENCE, checked under a row lock -- no skipping back,
// no re-entering an earlier status. 'cancelled' is a separate terminal
// state reachable from any non-terminal status, added here since v1's own
// order_status has no void/cancel state at all (see 0017_orders.sql).
import { pool } from "../db/pool.js";

export type OrderStatus = "requested" | "confirmed" | "picked" | "loaded" | "in_field" | "returned" | "cancelled";

const ORDER_FORWARD_SEQUENCE: OrderStatus[] = ["requested", "confirmed", "picked", "loaded", "in_field", "returned"];
const TERMINAL_STATUSES: OrderStatus[] = ["returned", "cancelled"];

export type Order = {
  id: string;
  requester_id: string;
  site_id: string | null;
  date_needed: string | null;
  status: OrderStatus;
  spec_notes: string | null;
  created_at: string;
};

export type OrderItem = {
  id: string;
  order_id: string;
  asset_id: string | null;
  consumable_id: string | null;
  quantity: string;
  unit_cost: string | null;
};

export async function createOrder(args: {
  requesterId: string;
  siteId?: string;
  dateNeeded?: string;
  specNotes?: string;
}): Promise<Order> {
  const result = await pool.query(
    `INSERT INTO orders (requester_id, site_id, date_needed, spec_notes) VALUES ($1, $2, $3, $4) RETURNING *`,
    [args.requesterId, args.siteId ?? null, args.dateNeeded ?? null, args.specNotes ?? null],
  );
  return result.rows[0] as Order;
}

// Exactly one of assetId/consumableId -- enforced by a DB CHECK
// (order_items_exactly_one_target).
export async function addOrderItem(args: {
  orderId: string;
  assetId?: string;
  consumableId?: string;
  quantity: number;
}): Promise<OrderItem> {
  const result = await pool.query(
    `INSERT INTO order_items (order_id, asset_id, consumable_id, quantity) VALUES ($1, $2, $3, $4) RETURNING *`,
    [args.orderId, args.assetId ?? null, args.consumableId ?? null, args.quantity],
  );
  return result.rows[0] as OrderItem;
}

// unit_cost is the real price actually paid, set independently after the
// fact -- not admin-gated, treated as operational cost data.
export async function setOrderItemUnitCost(orderItemId: string, unitCost: number): Promise<OrderItem | null> {
  const result = await pool.query(
    "UPDATE order_items SET unit_cost = $2 WHERE id = $1 RETURNING *",
    [orderItemId, unitCost],
  );
  return (result.rows[0] as OrderItem) ?? null;
}

export async function listOrderItems(orderId: string): Promise<OrderItem[]> {
  const result = await pool.query("SELECT * FROM order_items WHERE order_id = $1", [orderId]);
  return result.rows as OrderItem[];
}

export type AdvanceOrderStatusResult =
  | { ok: true; order: Order }
  | { ok: false; reason: "not_found" | "terminal" | "not_forward" };

export async function advanceOrderStatus(orderId: string, newStatus: OrderStatus): Promise<AdvanceOrderStatusResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = current.rows[0] as Order | undefined;
    if (!order) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (TERMINAL_STATUSES.includes(order.status)) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "terminal" };
    }
    if (newStatus !== "cancelled") {
      const currentIndex = ORDER_FORWARD_SEQUENCE.indexOf(order.status);
      const newIndex = ORDER_FORWARD_SEQUENCE.indexOf(newStatus);
      if (newIndex <= currentIndex) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "not_forward" };
      }
    }
    const updated = await client.query("UPDATE orders SET status = $2 WHERE id = $1 RETURNING *", [orderId, newStatus]);
    await client.query("COMMIT");
    return { ok: true, order: updated.rows[0] as Order };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listOrders(filter?: { status?: OrderStatus; requesterId?: string }): Promise<Order[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter?.requesterId) {
    params.push(filter.requesterId);
    conditions.push(`requester_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM orders ${where} ORDER BY created_at DESC`, params);
  return result.rows as Order[];
}

export async function getOrder(id: string): Promise<Order | null> {
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
  return (result.rows[0] as Order) ?? null;
}
