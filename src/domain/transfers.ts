// Re-expressed from v1's transfers domain logic -- requirements baseline,
// not copied code. Direct equipment movement site-to-site, bypassing a
// depot -- a relocation, not a custody handoff (custody stays modeled via
// checkouts; transfers only ever touches assets.current_site_id).
// Asset-only by design, same as v1.
import { pool } from "../db/pool.js";

export type TransferStatus = "requested" | "in_transit" | "completed" | "cancelled";

const TRANSFER_FORWARD_SEQUENCE: TransferStatus[] = ["requested", "in_transit", "completed"];
const TERMINAL_STATUSES: TransferStatus[] = ["completed", "cancelled"];

export type Transfer = {
  id: string;
  asset_id: string;
  from_site_id: string;
  to_site_id: string;
  requested_by: string;
  status: TransferStatus;
  created_at: string;
};

export type CreateTransferResult =
  | { ok: true; transfer: Transfer }
  | { ok: false; reason: "asset_not_found" | "asset_not_at_from_site" };

// Requires the asset's currently recorded site to actually equal
// from_site_id -- app-layer validation against current state, same as
// v1 (no DB-level constraint can express this, since it's cross-table).
export async function createTransfer(args: {
  assetId: string;
  fromSiteId: string;
  toSiteId: string;
  requestedBy: string;
}): Promise<CreateTransferResult> {
  const asset = await pool.query("SELECT current_site_id FROM assets WHERE id = $1", [args.assetId]);
  if (!asset.rows[0]) return { ok: false, reason: "asset_not_found" };
  if (asset.rows[0].current_site_id !== args.fromSiteId) return { ok: false, reason: "asset_not_at_from_site" };

  const result = await pool.query(
    `INSERT INTO transfers (asset_id, from_site_id, to_site_id, requested_by) VALUES ($1, $2, $3, $4) RETURNING *`,
    [args.assetId, args.fromSiteId, args.toSiteId, args.requestedBy],
  );
  return { ok: true, transfer: result.rows[0] as Transfer };
}

export type AdvanceTransferStatusResult =
  | { ok: true; transfer: Transfer }
  | { ok: false; reason: "not_found" | "terminal" | "not_forward" };

// Completing a transfer (status='completed') is the only point that
// actually updates assets.current_site_id -- 'requested'/'in_transit'
// don't move the recorded location yet, only the transfer record's state.
export async function advanceTransferStatus(transferId: string, newStatus: TransferStatus): Promise<AdvanceTransferStatusResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query("SELECT * FROM transfers WHERE id = $1 FOR UPDATE", [transferId]);
    const transfer = current.rows[0] as Transfer | undefined;
    if (!transfer) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "not_found" };
    }
    if (TERMINAL_STATUSES.includes(transfer.status)) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "terminal" };
    }
    if (newStatus !== "cancelled") {
      const currentIndex = TRANSFER_FORWARD_SEQUENCE.indexOf(transfer.status);
      const newIndex = TRANSFER_FORWARD_SEQUENCE.indexOf(newStatus);
      if (newIndex <= currentIndex) {
        await client.query("ROLLBACK");
        return { ok: false, reason: "not_forward" };
      }
    }
    const updated = await client.query("UPDATE transfers SET status = $2 WHERE id = $1 RETURNING *", [transferId, newStatus]);
    if (newStatus === "completed") {
      await client.query("UPDATE assets SET current_site_id = $2 WHERE id = $1", [transfer.asset_id, transfer.to_site_id]);
    }
    await client.query("COMMIT");
    return { ok: true, transfer: updated.rows[0] as Transfer };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listTransfers(filter?: { assetId?: string; status?: TransferStatus }): Promise<Transfer[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.assetId) {
    params.push(filter.assetId);
    conditions.push(`asset_id = $${params.length}`);
  }
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM transfers ${where} ORDER BY created_at DESC`, params);
  return result.rows as Transfer[];
}
