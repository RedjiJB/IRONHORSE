// Re-expressed from v1's spend_records domain logic -- requirements
// baseline, not copied code. status defaults 'approved' -- only
// method='personal_reimbursed' starts 'pending' (needs sign-off before
// trusted); everything else is a record of money already spent, trusted
// immediately. Mileage claims are the *other* creation path (see
// src/domain/mileageClaims.ts) -- an approved two-party confirmation
// inserts directly into this table, bypassing registerSpendRecord
// entirely.
import { pool } from "../db/pool.js";

export type SpendCategory = "material" | "fuel" | "mileage" | "receipt" | "other";
export type SpendMethod = "cash" | "company_card" | "personal_reimbursed";
export type SpendStatus = "pending" | "approved" | "rejected" | "disputed";

export type SpendRecord = {
  id: string;
  category: SpendCategory;
  method: SpendMethod;
  status: SpendStatus;
  amount: string | null;
  distance_km: string | null;
  rate_per_km: string | null;
  description: string | null;
  document_id: string | null;
  instrument_id: string | null;
  crew_member_id: string | null;
  submitted_by: string | null;
  submitted_by_user_id: string | null;
  occurred_at: string;
  reviewed_by: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  rejection_note: string | null;
  dispute_note: string | null;
  disputed_at: string | null;
  created_at: string;
};

export type RegisterSpendRecordResult =
  | { ok: true; record: SpendRecord }
  | { ok: false; reason: "mileage_requires_distance_km_and_personal_reimbursed" | "mileage_forbids_amount" | "amount_required" | "distance_km_forbidden" };

// category='mileage' requires method='personal_reimbursed', distance_km
// set (>0), and amount omitted; every other category requires amount
// (>0) and forbids distance_km. Dashboard-admin-only in practice (a
// manager keying in a company-card purchase or petty-cash spend on
// someone's behalf) -- enforced at the MCP tool tier, not here.
export async function registerSpendRecord(args: {
  category: SpendCategory;
  method: SpendMethod;
  amount?: number;
  distanceKm?: number;
  description?: string;
  documentId?: string;
  instrumentId?: string;
  crewMemberId?: string;
  submittedByUserId?: string;
}): Promise<RegisterSpendRecordResult> {
  if (args.category === "mileage") {
    if (args.method !== "personal_reimbursed" || args.distanceKm == null || args.distanceKm <= 0) {
      return { ok: false, reason: "mileage_requires_distance_km_and_personal_reimbursed" };
    }
    if (args.amount != null) return { ok: false, reason: "mileage_forbids_amount" };
  } else {
    if (args.amount == null || args.amount <= 0) return { ok: false, reason: "amount_required" };
    if (args.distanceKm != null) return { ok: false, reason: "distance_km_forbidden" };
  }

  const status: SpendStatus = args.method === "personal_reimbursed" ? "pending" : "approved";
  const result = await pool.query(
    `INSERT INTO spend_records (category, method, status, amount, distance_km, description, document_id, instrument_id, crew_member_id, submitted_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      args.category, args.method, status, args.amount ?? null, args.distanceKm ?? null, args.description ?? null,
      args.documentId ?? null, args.instrumentId ?? null, args.crewMemberId ?? null, args.submittedByUserId ?? null,
    ],
  );
  return { ok: true, record: result.rows[0] as SpendRecord };
}

export async function listSpendRecords(filter?: { crewMemberId?: string; status?: SpendStatus; category?: SpendCategory }): Promise<SpendRecord[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.crewMemberId) {
    params.push(filter.crewMemberId);
    conditions.push(`crew_member_id = $${params.length}`);
  }
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter?.category) {
    params.push(filter.category);
    conditions.push(`category = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM spend_records ${where} ORDER BY occurred_at DESC`, params);
  return result.rows as SpendRecord[];
}

// Mileage never has a receipt by nature -- excluded, same as v1.
export async function listMissingReceipts(): Promise<SpendRecord[]> {
  const result = await pool.query(
    `SELECT * FROM spend_records WHERE document_id IS NULL AND category != 'mileage' AND status = 'approved' ORDER BY occurred_at`,
  );
  return result.rows as SpendRecord[];
}

export type ReviewSpendRecordResult = { ok: true; record: SpendRecord } | { ok: false; reason: "not_found" | "not_pending" };

export async function approveSpendRecord(id: string, reviewer: { crewMemberId?: string; userId?: string }): Promise<ReviewSpendRecordResult> {
  const existing = await pool.query("SELECT status FROM spend_records WHERE id = $1", [id]);
  if (!existing.rows[0]) return { ok: false, reason: "not_found" };
  if (existing.rows[0].status !== "pending") return { ok: false, reason: "not_pending" };

  const result = await pool.query(
    `UPDATE spend_records SET status = 'approved', reviewed_by = $2, reviewed_by_user_id = $3, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [id, reviewer.crewMemberId ?? null, reviewer.userId ?? null],
  );
  return { ok: true, record: result.rows[0] as SpendRecord };
}

export async function rejectSpendRecord(id: string, reviewer: { crewMemberId?: string; userId?: string }, note?: string): Promise<ReviewSpendRecordResult> {
  const existing = await pool.query("SELECT status FROM spend_records WHERE id = $1", [id]);
  if (!existing.rows[0]) return { ok: false, reason: "not_found" };
  if (existing.rows[0].status !== "pending") return { ok: false, reason: "not_pending" };

  const result = await pool.query(
    `UPDATE spend_records SET status = 'rejected', reviewed_by = $2, reviewed_by_user_id = $3, reviewed_at = now(), rejection_note = $4 WHERE id = $1 RETURNING *`,
    [id, reviewer.crewMemberId ?? null, reviewer.userId ?? null, note ?? null],
  );
  return { ok: true, record: result.rows[0] as SpendRecord };
}

export type DisputeSpendRecordResult = { ok: true; record: SpendRecord } | { ok: false; reason: "not_found" | "not_rejected" | "already_disputed" };

// One round only, same as v1 -- disputed_at is a permanent marker, not
// re-clearable.
export async function disputeSpendRecord(id: string, note: string): Promise<DisputeSpendRecordResult> {
  const existing = await pool.query("SELECT status, disputed_at FROM spend_records WHERE id = $1", [id]);
  const row = existing.rows[0];
  if (!row) return { ok: false, reason: "not_found" };
  if (row.disputed_at) return { ok: false, reason: "already_disputed" };
  if (row.status !== "rejected") return { ok: false, reason: "not_rejected" };

  const result = await pool.query(
    `UPDATE spend_records SET status = 'disputed', dispute_note = $2, disputed_at = now() WHERE id = $1 RETURNING *`,
    [id, note],
  );
  return { ok: true, record: result.rows[0] as SpendRecord };
}
