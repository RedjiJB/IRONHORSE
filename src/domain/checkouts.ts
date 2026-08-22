// Re-expressed from v1's checkouts domain logic -- requirements baseline,
// not copied code. Tracks one asset's custody by exactly one crew member
// at a time. Creating a checkout is real dispatch/logistics authority
// (gated by capability tier directly, like assign_shift) -- but a
// checkout's *return*, specifically any damage/condition claim on it,
// isn't independently verifiable from the crew member's own report, so
// that goes through the same two-party confirm-before-execute pattern as
// timeclock events and asset verification.
import { pool } from "../db/pool.js";
import { registerConfirmationExecutor } from "./confirmations.js";

export type Checkout = {
  id: string;
  asset_id: string;
  order_id: string | null;
  checked_out_by: string;
  checked_out_at: string;
  expected_return_at: string | null;
  checked_in_at: string | null;
  damage_flag: boolean;
  damage_note: string | null;
  photo_url: string | null;
  returned_by: string | null;
};

export type CreateCheckoutResult =
  | { ok: true; checkout: Checkout }
  | { ok: false; reason: "asset_not_found" | "asset_not_available" };

// Transactional with a row lock on the asset -- this, combined with
// requiring status='available', is what makes double-checkout of the same
// asset structurally impossible, not just application discipline.
export async function createCheckout(args: {
  assetId: string;
  checkedOutBy: string;
  orderId?: string;
  expectedReturnAt?: string;
}): Promise<CreateCheckoutResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const assetRow = await client.query("SELECT status FROM assets WHERE id = $1 FOR UPDATE", [args.assetId]);
    if (!assetRow.rows[0]) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "asset_not_found" };
    }
    if (assetRow.rows[0].status !== "available") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "asset_not_available" };
    }
    const checkoutRow = await client.query(
      `INSERT INTO checkouts (asset_id, order_id, checked_out_by, expected_return_at)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [args.assetId, args.orderId ?? null, args.checkedOutBy, args.expectedReturnAt ?? null],
    );
    await client.query(
      "UPDATE assets SET status = 'checked_out', current_holder = $2 WHERE id = $1",
      [args.assetId, args.checkedOutBy],
    );
    await client.query("COMMIT");
    return { ok: true, checkout: checkoutRow.rows[0] as Checkout };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listCheckouts(filter?: { assetId?: string; outstanding?: boolean }): Promise<Checkout[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.assetId) {
    params.push(filter.assetId);
    conditions.push(`asset_id = $${params.length}`);
  }
  if (filter?.outstanding) {
    conditions.push("checked_in_at IS NULL");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM checkouts ${where} ORDER BY checked_out_at DESC`, params);
  return result.rows as Checkout[];
}

// Same filter the alerts engine's 'overdue' check will eventually use
// (that worker itself is separate, deferred scope) -- exposed here as a
// plain query so it's usable today without waiting on that slice.
export async function listOverdueCheckouts(): Promise<Checkout[]> {
  const result = await pool.query(
    `SELECT * FROM checkouts
     WHERE checked_in_at IS NULL AND expected_return_at IS NOT NULL AND expected_return_at < now()
     ORDER BY expected_return_at`,
  );
  return result.rows as Checkout[];
}

// Registered once at server startup (see src/mcp/tools/checkouts.ts). A
// damaged return routes the asset to in_maintenance, never straight back
// to available. Either way current_holder is cleared.
export function registerCheckoutReturnExecutor(): void {
  registerConfirmationExecutor("checkout_return", async (payload) => {
    const checkoutId = payload.checkoutId as string;
    const damageFlag = Boolean(payload.damageFlag);
    const damageNote = (payload.damageNote as string | null | undefined) ?? null;
    const photoUrl = (payload.photoUrl as string | null | undefined) ?? null;
    const returnedBy = payload.returnedBy as string;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const checkoutRow = await client.query("SELECT * FROM checkouts WHERE id = $1 FOR UPDATE", [checkoutId]);
      const checkout = checkoutRow.rows[0] as Checkout | undefined;
      if (!checkout) throw new Error("checkout_return failed: not_found");
      if (checkout.checked_in_at) throw new Error("checkout_return failed: already_returned");

      const updated = await client.query(
        `UPDATE checkouts SET checked_in_at = now(), damage_flag = $2, damage_note = $3, photo_url = $4, returned_by = $5
         WHERE id = $1 RETURNING *`,
        [checkoutId, damageFlag, damageNote, photoUrl, returnedBy],
      );
      await client.query(
        `UPDATE assets SET status = $2, current_holder = NULL WHERE id = $1`,
        [checkout.asset_id, damageFlag ? "in_maintenance" : "available"],
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
