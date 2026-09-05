// Lone-worker check-in timer (FEATURES.md §2: "auto-alert if no activity
// in X minutes"). See 0018_lone_worker_checkins.sql for why "overdue" is
// a read-only query, not an active poller.
import { pool } from "../db/pool.js";
import { getShift } from "./shifts.js";

export type LoneWorkerCheckin = {
  id: string;
  shift_id: string;
  guard_id: string;
  checked_in_at: string;
  next_due_at: string;
  lat: number | null;
  lng: number | null;
};

export type CheckInResult =
  | { ok: true; checkin: LoneWorkerCheckin }
  | { ok: false; reason: "shift_not_found" | "shift_not_owned_by_guard" };

// Same shift-ownership enforcement as patrols.ts/handoffNotes.ts -- the
// shift has to actually be this guard's own assignment, not just any
// shift id that happens to exist. intervalMinutes is the guard's own
// call (site conditions vary), not a system-wide constant.
export async function checkIn(args: {
  shiftId: string;
  guardId: string;
  intervalMinutes: number;
  lat?: number | null;
  lng?: number | null;
}): Promise<CheckInResult> {
  const shift = await getShift(args.shiftId);
  if (!shift) return { ok: false, reason: "shift_not_found" };
  if (shift.guard_id !== args.guardId) return { ok: false, reason: "shift_not_owned_by_guard" };

  const result = await pool.query(
    `INSERT INTO lone_worker_checkins (shift_id, guard_id, next_due_at, lat, lng)
     VALUES ($1, $2, now() + ($3 || ' minutes')::interval, $4, $5)
     RETURNING *`,
    [args.shiftId, args.guardId, args.intervalMinutes, args.lat ?? null, args.lng ?? null],
  );
  return { ok: true, checkin: result.rows[0] as LoneWorkerCheckin };
}

export async function listCheckins(filter?: { shiftId?: string; guardId?: string }): Promise<LoneWorkerCheckin[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.shiftId) {
    params.push(filter.shiftId);
    conditions.push(`shift_id = $${params.length}`);
  }
  if (filter?.guardId) {
    params.push(filter.guardId);
    conditions.push(`guard_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM lone_worker_checkins ${where} ORDER BY checked_in_at DESC`, params);
  return result.rows as LoneWorkerCheckin[];
}

export async function getLatestCheckin(shiftId: string): Promise<LoneWorkerCheckin | null> {
  const result = await pool.query(
    "SELECT * FROM lone_worker_checkins WHERE shift_id = $1 ORDER BY checked_in_at DESC LIMIT 1",
    [shiftId],
  );
  return (result.rows[0] as LoneWorkerCheckin) ?? null;
}

export type OverdueLoneWorker = LoneWorkerCheckin & { site_id: string };

// Only surfaces shifts that have checked in at least once and then gone
// quiet -- a guard who never checks in at all isn't flagged by this query,
// same "visibility only" scope compliance's expiring/expired queries and
// equipment's listOverdueEquipmentCheckouts already have. Restricting to
// 'confirmed' shifts avoids flagging a shift nobody is actually working.
export async function listOverdueLoneWorkers(): Promise<OverdueLoneWorker[]> {
  const result = await pool.query(
    `SELECT lc.*, s.site_id
     FROM shifts s
     JOIN LATERAL (
       SELECT * FROM lone_worker_checkins c
       WHERE c.shift_id = s.id
       ORDER BY c.checked_in_at DESC
       LIMIT 1
     ) lc ON true
     WHERE s.status = 'confirmed' AND lc.next_due_at < now()
     ORDER BY lc.next_due_at`,
  );
  return result.rows as OverdueLoneWorker[];
}
