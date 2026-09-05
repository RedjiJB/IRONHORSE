// Weapon/equipment issue log (FEATURES.md §2). Adapted from
// dcentral-fieldops's assets.ts + checkouts.ts -- see
// 0016_equipment.sql's header for the one deliberate simplification
// (no physical-verification gate before an item is first 'available').
import { pool } from "../db/pool.js";
import { registerConfirmationExecutor } from "./confirmations.js";

export type EquipmentStatus = "available" | "checked_out" | "in_maintenance" | "missing" | "retired";

// Mirrors assets.ts's DIRECTLY_SETTABLE_STATUSES -- 'available' and
// 'checked_out' are only ever entered/exited through the checkout
// lifecycle below, never this generic route.
const DIRECTLY_SETTABLE_STATUSES: EquipmentStatus[] = ["missing", "in_maintenance", "retired"];

export type Equipment = {
  id: string;
  name: string;
  category: string;
  serial_number: string | null;
  site_id: string | null;
  status: EquipmentStatus;
  current_holder_guard_id: string | null;
  created_at: string;
};

export async function registerEquipment(args: {
  name: string;
  category: string;
  serialNumber?: string;
  siteId?: string;
}): Promise<Equipment> {
  const result = await pool.query(
    `INSERT INTO equipment (name, category, serial_number, site_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [args.name, args.category, args.serialNumber ?? null, args.siteId ?? null],
  );
  return result.rows[0] as Equipment;
}

export type SetEquipmentStatusResult = { ok: true; equipment: Equipment } | { ok: false; reason: "not_found" | "status_not_directly_settable" };

export async function setEquipmentStatus(id: string, status: EquipmentStatus): Promise<SetEquipmentStatusResult> {
  if (!DIRECTLY_SETTABLE_STATUSES.includes(status)) {
    return { ok: false, reason: "status_not_directly_settable" };
  }
  const result = await pool.query(`UPDATE equipment SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
  if (!result.rows[0]) return { ok: false, reason: "not_found" };
  return { ok: true, equipment: result.rows[0] as Equipment };
}

export async function listEquipment(filter?: { status?: EquipmentStatus; category?: string }): Promise<Equipment[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter?.category) {
    params.push(filter.category);
    conditions.push(`category = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM equipment ${where} ORDER BY name`, params);
  return result.rows as Equipment[];
}

export async function getEquipment(id: string): Promise<Equipment | null> {
  const result = await pool.query("SELECT * FROM equipment WHERE id = $1", [id]);
  return (result.rows[0] as Equipment) ?? null;
}

export type EquipmentCheckout = {
  id: string;
  equipment_id: string;
  checked_out_by_guard_id: string;
  checked_out_at: string;
  expected_return_at: string | null;
  checked_in_at: string | null;
  condition_flag: boolean;
  condition_note: string | null;
  returned_by_guard_id: string | null;
};

export type CheckOutEquipmentResult =
  | { ok: true; checkout: EquipmentCheckout }
  | { ok: false; reason: "equipment_not_found" | "equipment_not_available" };

// Transactional with a row lock on the equipment row -- combined with
// requiring status = 'available', this is what makes double-checkout of
// the same item structurally impossible, not just application discipline.
// Issuing equipment is real dispatch/logistics authority (capability-gated
// directly, like assign_shift) -- it's the *return* that needs the
// two-party confirmation, not this step.
export async function checkOutEquipment(args: {
  equipmentId: string;
  guardId: string;
  expectedReturnAt?: string;
}): Promise<CheckOutEquipmentResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const equipmentRow = await client.query("SELECT status FROM equipment WHERE id = $1 FOR UPDATE", [args.equipmentId]);
    if (!equipmentRow.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "equipment_not_found" };
    }
    if (equipmentRow.rows[0].status !== "available") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "equipment_not_available" };
    }
    const checkoutRow = await client.query(
      `INSERT INTO equipment_checkouts (equipment_id, checked_out_by_guard_id, expected_return_at)
       VALUES ($1, $2, $3) RETURNING *`,
      [args.equipmentId, args.guardId, args.expectedReturnAt ?? null],
    );
    await client.query(
      "UPDATE equipment SET status = 'checked_out', current_holder_guard_id = $2 WHERE id = $1",
      [args.equipmentId, args.guardId],
    );
    await client.query("COMMIT");
    return { ok: true, checkout: checkoutRow.rows[0] as EquipmentCheckout };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listEquipmentCheckouts(filter?: { equipmentId?: string; outstanding?: boolean }): Promise<EquipmentCheckout[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.equipmentId) {
    params.push(filter.equipmentId);
    conditions.push(`equipment_id = $${params.length}`);
  }
  if (filter?.outstanding) {
    conditions.push("checked_in_at IS NULL");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM equipment_checkouts ${where} ORDER BY checked_out_at DESC`, params);
  return result.rows as EquipmentCheckout[];
}

export async function listOverdueEquipmentCheckouts(): Promise<EquipmentCheckout[]> {
  const result = await pool.query(
    `SELECT * FROM equipment_checkouts
     WHERE checked_in_at IS NULL AND expected_return_at IS NOT NULL AND expected_return_at < now()
     ORDER BY expected_return_at`,
  );
  return result.rows as EquipmentCheckout[];
}

// Registered once at server startup (see src/mcp/tools/equipment.ts). A
// condition-flagged (damaged) return routes the equipment to
// 'in_maintenance', never straight back to 'available'. Either way
// current_holder_guard_id is cleared. Re-validated against CURRENT state
// at approval time (checked_in_at re-checked under the row lock), not
// trusted from submission -- same discipline every other
// confirm-before-execute executor in this system follows.
export function registerEquipmentReturnExecutor(): void {
  registerConfirmationExecutor("equipment_return", async (payload) => {
    const checkoutId = payload.checkoutId as string;
    const conditionFlag = Boolean(payload.conditionFlag);
    const conditionNote = (payload.conditionNote as string | null | undefined) ?? null;
    const returnedByGuardId = payload.returnedByGuardId as string;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const checkoutRow = await client.query("SELECT * FROM equipment_checkouts WHERE id = $1 FOR UPDATE", [checkoutId]);
      const checkout = checkoutRow.rows[0] as EquipmentCheckout | undefined;
      if (!checkout) throw new Error("equipment_return failed: not_found");
      if (checkout.checked_in_at) throw new Error("equipment_return failed: already_returned");

      const updated = await client.query(
        `UPDATE equipment_checkouts SET checked_in_at = now(), condition_flag = $2, condition_note = $3, returned_by_guard_id = $4
         WHERE id = $1 RETURNING *`,
        [checkoutId, conditionFlag, conditionNote, returnedByGuardId],
      );
      await client.query(
        `UPDATE equipment SET status = $2, current_holder_guard_id = NULL WHERE id = $1`,
        [checkout.equipment_id, conditionFlag ? "in_maintenance" : "available"],
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
