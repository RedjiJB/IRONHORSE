// Generalized confirm-before-execute (see src/db/migrations/0010_pending_confirmations.sql
// for why this replaces v1's hard-coded 7-tool pilot with an open registry
// instead of a CHECK-constrained enum widened by migration every time a
// new action needs the gate). An action_type registers an executor here
// once; src/mcp/confirmable.ts's requiresIndependentConfirmation tool
// wrapper is what actually creates the pending row when a gated tool is
// called -- this module only owns submit/list/approve/reject and the
// registry, not any specific tool's argument shape.
import { pool } from "../db/pool.js";
import { getCrewMember, isManagementRole } from "./crewMembers.js";

export type PendingConfirmation = {
  id: string;
  action_type: string;
  capability: string;
  summary: string;
  payload: Record<string, unknown>;
  submitted_by: string;
  status: "awaiting_review" | "approved" | "rejected";
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_note: string | null;
  result_id: string | null;
  created_at: string;
};

export type ConfirmationExecutor = (payload: Record<string, unknown>) => Promise<{ resultId: string }>;

const executors = new Map<string, ConfirmationExecutor>();

// Called once at startup by each domain module that has a confirmable
// action (see src/domain/timeclock.ts's registration at the bottom of
// this file's import chain, wired from src/mcp/tools/timeclock.ts).
export function registerConfirmationExecutor(actionType: string, executor: ConfirmationExecutor): void {
  executors.set(actionType, executor);
}

export async function submitForConfirmation(args: {
  actionType: string;
  capability: string;
  summary: string;
  payload: Record<string, unknown>;
  submittedByCrewMemberId: string;
}): Promise<PendingConfirmation> {
  const result = await pool.query(
    `INSERT INTO pending_confirmations (action_type, capability, summary, payload, submitted_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [args.actionType, args.capability, args.summary, JSON.stringify(args.payload), args.submittedByCrewMemberId],
  );
  return result.rows[0] as PendingConfirmation;
}

export async function listPendingConfirmations(): Promise<PendingConfirmation[]> {
  const result = await pool.query(
    "SELECT * FROM pending_confirmations WHERE status = 'awaiting_review' ORDER BY created_at",
  );
  return result.rows as PendingConfirmation[];
}

export type ReviewResult =
  | { ok: true; confirmation: PendingConfirmation }
  | { ok: false; reason: "not_found" | "already_reviewed" | "reviewer_not_found" | "reviewer_not_management" | "no_executor_registered" };

export async function approveConfirmation(id: string, reviewerCrewMemberId: string): Promise<ReviewResult> {
  const pending = await pool.query("SELECT * FROM pending_confirmations WHERE id = $1", [id]);
  const row = pending.rows[0] as PendingConfirmation | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "awaiting_review") return { ok: false, reason: "already_reviewed" };

  const reviewer = await getCrewMember(reviewerCrewMemberId);
  if (!reviewer) return { ok: false, reason: "reviewer_not_found" };
  if (!isManagementRole(reviewer.role)) return { ok: false, reason: "reviewer_not_management" };

  const executor = executors.get(row.action_type);
  if (!executor) return { ok: false, reason: "no_executor_registered" };

  // Re-validates against CURRENT state, not state at submission time --
  // e.g. a timeclock event's geofence gets re-resolved fresh here, same
  // reasoning v1 documented for its own approval handlers: the world may
  // have changed between submission and review.
  const { resultId } = await executor(row.payload);

  const updated = await pool.query(
    `UPDATE pending_confirmations
     SET status = 'approved', reviewed_by = $2, reviewed_at = now(), result_id = $3
     WHERE id = $1
     RETURNING *`,
    [id, reviewerCrewMemberId, resultId],
  );
  return { ok: true, confirmation: updated.rows[0] as PendingConfirmation };
}

export async function rejectConfirmation(
  id: string,
  reviewerCrewMemberId: string,
  note?: string,
): Promise<ReviewResult> {
  const pending = await pool.query("SELECT * FROM pending_confirmations WHERE id = $1", [id]);
  const row = pending.rows[0] as PendingConfirmation | undefined;
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "awaiting_review") return { ok: false, reason: "already_reviewed" };

  const reviewer = await getCrewMember(reviewerCrewMemberId);
  if (!reviewer) return { ok: false, reason: "reviewer_not_found" };
  if (!isManagementRole(reviewer.role)) return { ok: false, reason: "reviewer_not_management" };

  const updated = await pool.query(
    `UPDATE pending_confirmations
     SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), rejection_note = $3
     WHERE id = $1
     RETURNING *`,
    [id, reviewerCrewMemberId, note ?? null],
  );
  return { ok: true, confirmation: updated.rows[0] as PendingConfirmation };
}
