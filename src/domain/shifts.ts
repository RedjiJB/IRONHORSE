import { pool } from "../db/pool.js";

export type ShiftStatus = "assigned" | "confirmed" | "declined" | "no_show";

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
