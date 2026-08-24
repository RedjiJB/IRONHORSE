import { pool } from "../db/pool.js";
import { registerConfirmationExecutor } from "./confirmations.js";

export type ShiftStatus = "assigned" | "confirmed" | "declined" | "no_show";

export type Shift = {
  id: string;
  crew_member_id: string;
  site_id: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  status: ShiftStatus;
  nudged_at: string | null;
  reminder_sent_at: string | null;
  job_id: string | null;
  created_at: string;
};

export async function assignShift(args: {
  crewMemberId: string;
  siteId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  jobId?: string;
}): Promise<Shift> {
  const result = await pool.query(
    `INSERT INTO shifts (crew_member_id, site_id, date, start_time, end_time, job_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [args.crewMemberId, args.siteId, args.date, args.startTime ?? null, args.endTime ?? null, args.jobId ?? null],
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

export async function listShifts(filter?: { crewMemberId?: string; siteId?: string; date?: string; status?: ShiftStatus }): Promise<Shift[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.crewMemberId) {
    params.push(filter.crewMemberId);
    conditions.push(`crew_member_id = $${params.length}`);
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

// A crew member requesting to work later than their shift's originally
// assigned end_time -- part of v1's confirm-before-execute action set
// ("shift extensions") that had no equivalent tool here yet. Unlike
// confirmShift (accepting/declining a shift already set by someone with
// scheduling authority), this changes the shift's actual bounds, so it
// goes through the same submit/review gate as timeclock events and
// consumable adjustments rather than executing directly.
export async function extendShift(shiftId: string, newEndTime: string): Promise<Shift | null> {
  const result = await pool.query(`UPDATE shifts SET end_time = $2 WHERE id = $1 RETURNING *`, [shiftId, newEndTime]);
  return (result.rows[0] as Shift) ?? null;
}

export function registerShiftExtensionExecutor(): void {
  registerConfirmationExecutor("shift_extension", async (payload) => {
    const shiftId = payload.shiftId as string;
    const newEndTime = payload.newEndTime as string;
    const shift = await extendShift(shiftId, newEndTime);
    if (!shift) throw new Error("shift_extension failed: shift not found");
    return { resultId: shift.id };
  });
}
