// Shift handoff notes (FEATURES.md §2: "structured info for the next
// guard"). No dcentral-fieldops equivalent to adapt -- landscaping crews
// have no post-to-post handoff concept. See 0017_shift_handoff_notes.sql
// for why this is site-scoped rather than shift-to-shift.
import { pool } from "../db/pool.js";
import { getShift } from "./shifts.js";

export type HandoffNote = {
  id: string;
  site_id: string;
  from_shift_id: string;
  author_guard_id: string;
  category: string;
  body: string;
  created_at: string;
  acknowledged_by_guard_id: string | null;
  acknowledged_at: string | null;
};

export type LeaveHandoffNoteResult =
  | { ok: true; note: HandoffNote }
  | { ok: false; reason: "shift_not_found" | "shift_not_owned_by_guard" | "shift_site_mismatch" };

// Same shift-ownership enforcement as patrols.ts's startPatrolRun -- the
// shift has to actually be this guard's own assignment at this site, not
// just any shift id that happens to exist.
export async function leaveHandoffNote(args: {
  siteId: string;
  fromShiftId: string;
  authorGuardId: string;
  category: string;
  body: string;
}): Promise<LeaveHandoffNoteResult> {
  const shift = await getShift(args.fromShiftId);
  if (!shift) return { ok: false, reason: "shift_not_found" };
  if (shift.guard_id !== args.authorGuardId) return { ok: false, reason: "shift_not_owned_by_guard" };
  if (shift.site_id !== args.siteId) return { ok: false, reason: "shift_site_mismatch" };

  const result = await pool.query(
    `INSERT INTO shift_handoff_notes (site_id, from_shift_id, author_guard_id, category, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [args.siteId, args.fromShiftId, args.authorGuardId, args.category, args.body],
  );
  return { ok: true, note: result.rows[0] as HandoffNote };
}

export async function listHandoffNotes(filter?: { siteId?: string; unacknowledgedOnly?: boolean }): Promise<HandoffNote[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.siteId) {
    params.push(filter.siteId);
    conditions.push(`site_id = $${params.length}`);
  }
  if (filter?.unacknowledgedOnly) {
    conditions.push("acknowledged_at IS NULL");
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM shift_handoff_notes ${where} ORDER BY created_at DESC`, params);
  return result.rows as HandoffNote[];
}

export async function getHandoffNote(id: string): Promise<HandoffNote | null> {
  const result = await pool.query("SELECT * FROM shift_handoff_notes WHERE id = $1", [id]);
  return (result.rows[0] as HandoffNote) ?? null;
}

export type AcknowledgeHandoffNoteResult =
  | { ok: true; note: HandoffNote }
  | { ok: false; reason: "note_not_found" | "shift_not_found" | "shift_not_owned_by_guard" | "shift_site_mismatch" };

// Acknowledging requires the caller's own shift at the same site -- same
// ownership check as leaving the note, so it proves someone actually on
// duty there read it rather than any authenticated guard. Idempotent like
// messages.markMessageRead: acking an already-acknowledged note just
// returns the existing state, since it's the first read that matters, not
// who's allowed to be second.
export async function acknowledgeHandoffNote(args: {
  noteId: string;
  shiftId: string;
  guardId: string;
}): Promise<AcknowledgeHandoffNoteResult> {
  const note = await getHandoffNote(args.noteId);
  if (!note) return { ok: false, reason: "note_not_found" };
  if (note.acknowledged_at) return { ok: true, note };

  const shift = await getShift(args.shiftId);
  if (!shift) return { ok: false, reason: "shift_not_found" };
  if (shift.guard_id !== args.guardId) return { ok: false, reason: "shift_not_owned_by_guard" };
  if (shift.site_id !== note.site_id) return { ok: false, reason: "shift_site_mismatch" };

  const result = await pool.query(
    `UPDATE shift_handoff_notes SET acknowledged_by_guard_id = $2, acknowledged_at = now() WHERE id = $1 RETURNING *`,
    [args.noteId, args.guardId],
  );
  return { ok: true, note: result.rows[0] as HandoffNote };
}
