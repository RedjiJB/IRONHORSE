import { pool } from "../db/pool.js";

export type ShiftStatus = "assigned" | "confirmed" | "declined" | "no_show" | "reassigned";

export type Shift = {
  id: string;
  guard_id: string;
  site_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: ShiftStatus;
  post_id: string | null;
  created_at: string;
  reassigned_from_shift_id: string | null;
};

// postId is optional -- a shift not tied to a post works exactly as it
// did before posts existed (DOMAIN-DESIGN.md §5). When it is set, the
// caller (the MCP tool/façade route) is expected to also check
// certifications.ts's checkGuardPostCompliance and surface any gap as a
// warning -- this function itself never blocks on it, per the resolved
// soft-flag decision.
export async function assignShift(args: {
  guardId: string;
  siteId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  postId?: string;
}): Promise<Shift> {
  const result = await pool.query(
    `INSERT INTO shifts (guard_id, site_id, date, start_time, end_time, post_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [args.guardId, args.siteId, args.date, args.startTime ?? null, args.endTime ?? null, args.postId ?? null],
  );
  return result.rows[0] as Shift;
}

export async function confirmShift(shiftId: string, decision: "confirmed" | "declined"): Promise<Shift | null> {
  const result = await pool.query(
    `UPDATE shifts SET status = $2 WHERE id = $1 RETURNING *`,
    [shiftId, decision],
  );
  return (result.rows[0] as Shift) ?? null;
}

export type ReassignShiftResult =
  | { ok: true; oldShift: Shift; newShift: Shift }
  | { ok: false; reason: "shift_not_found" | "shift_already_reassigned" };

// Override/reassign shift on the fly (FEATURES.md §3). Marks the
// outgoing shift 'no_show' or 'reassigned' -- the caller's call which
// applies, see 0019_shift_reassignment.sql's header -- and creates a
// fresh shift for the replacement guard at the same site/date/time/post,
// linked back via reassigned_from_shift_id for an audit trail. Like
// equipment.ts's checkOutEquipment, transactional with a row lock on the
// outgoing shift so two supervisors can't both reassign the same one out
// from under each other. Compliance checking (DOMAIN-DESIGN.md §5, soft
// flag) is the caller's job when newShift.post_id is set, same layering
// assignShift already uses -- this function never blocks on it.
export async function reassignShift(args: {
  shiftId: string;
  newGuardId: string;
  outgoingStatus: "no_show" | "reassigned";
}): Promise<ReassignShiftResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const outgoingRow = await client.query("SELECT * FROM shifts WHERE id = $1 FOR UPDATE", [args.shiftId]);
    const outgoing = outgoingRow.rows[0] as Shift | undefined;
    if (!outgoing) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "shift_not_found" };
    }
    if (outgoing.status === "no_show" || outgoing.status === "reassigned") {
      await client.query("ROLLBACK");
      return { ok: false, reason: "shift_already_reassigned" };
    }

    const updatedOutgoing = await client.query(
      `UPDATE shifts SET status = $2 WHERE id = $1 RETURNING *`,
      [args.shiftId, args.outgoingStatus],
    );
    const newShiftRow = await client.query(
      `INSERT INTO shifts (guard_id, site_id, date, start_time, end_time, post_id, reassigned_from_shift_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [args.newGuardId, outgoing.site_id, outgoing.date, outgoing.start_time, outgoing.end_time, outgoing.post_id, outgoing.id],
    );
    await client.query("COMMIT");
    return { ok: true, oldShift: updatedOutgoing.rows[0] as Shift, newShift: newShiftRow.rows[0] as Shift };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listShifts(filter?: { guardId?: string; siteId?: string; date?: string; status?: ShiftStatus }): Promise<Shift[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.guardId) {
    params.push(filter.guardId);
    conditions.push(`guard_id = $${params.length}`);
  }
  if (filter?.siteId) {
    params.push(filter.siteId);
    conditions.push(`site_id = $${params.length}`);
  }
  if (filter?.date) {
    params.push(filter.date);
    conditions.push(`date = $${params.length}`);
  }
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM shifts ${where} ORDER BY date, start_time`, params);
  return result.rows as Shift[];
}

export async function getShift(id: string): Promise<Shift | null> {
  const result = await pool.query("SELECT * FROM shifts WHERE id = $1", [id]);
  return (result.rows[0] as Shift) ?? null;
}
