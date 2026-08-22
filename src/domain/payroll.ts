// Re-expressed from v1's payroll domain logic -- requirements baseline,
// not copied code. No real payroll processing exists here either -- no
// pay run, no direct-deposit integration, no tax withholding. Two
// deliberately independent tables (crew_pay_profiles = "what someone is
// paid", payouts = "what they were actually paid") reconciled only by a
// computed view, never stored.
import { pool } from "../db/pool.js";
import { fetchSessionsInRange } from "./timeclockSessions.js";
import { getNotificationSettings } from "./notificationSettings.js";

export type PayType = "payroll" | "cash";

export type CrewPayProfile = {
  crew_member_id: string;
  pay_type: PayType;
  hourly_rate: string | null;
  updated_at: string;
};

export async function setCrewPayProfile(crewMemberId: string, args: { payType?: PayType; hourlyRate?: number }): Promise<CrewPayProfile> {
  const result = await pool.query(
    `INSERT INTO crew_pay_profiles (crew_member_id, pay_type, hourly_rate)
     VALUES ($1, COALESCE($2, 'payroll'), $3)
     ON CONFLICT (crew_member_id) DO UPDATE SET
       pay_type = COALESCE($2, crew_pay_profiles.pay_type),
       hourly_rate = COALESCE($3, crew_pay_profiles.hourly_rate),
       updated_at = now()
     RETURNING *`,
    [crewMemberId, args.payType ?? null, args.hourlyRate ?? null],
  );
  return result.rows[0] as CrewPayProfile;
}

export async function getCrewPayProfile(crewMemberId: string): Promise<CrewPayProfile | null> {
  const result = await pool.query("SELECT * FROM crew_pay_profiles WHERE crew_member_id = $1", [crewMemberId]);
  return (result.rows[0] as CrewPayProfile) ?? null;
}

export type Payout = {
  id: string;
  crew_member_id: string;
  amount: string;
  paid_at: string;
  note: string | null;
  recorded_by_user_id: string;
  created_at: string;
};

// Always a dashboard admin, no agent/crew path at all -- same as v1. The
// app never moves money; this is a manual "I paid this person" log entry.
export async function recordPayout(args: { crewMemberId: string; amount: number; note?: string; recordedByUserId: string; paidAt?: string }): Promise<Payout> {
  const result = await pool.query(
    `INSERT INTO payouts (crew_member_id, amount, note, recorded_by_user_id, paid_at)
     VALUES ($1, $2, $3, $4, COALESCE($5, now())) RETURNING *`,
    [args.crewMemberId, args.amount, args.note ?? null, args.recordedByUserId, args.paidAt ?? null],
  );
  return result.rows[0] as Payout;
}

export async function listPayouts(filter?: { crewMemberId?: string }): Promise<Payout[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.crewMemberId) {
    params.push(filter.crewMemberId);
    conditions.push(`crew_member_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM payouts ${where} ORDER BY paid_at DESC`, params);
  return result.rows as Payout[];
}

export type ReconciliationResult = {
  crewMemberId: string;
  hoursWorked: number;
  incompleteSessions: number;
  hourlyRate: number | null;
  amountOwed: number | null; // null (never 0) when no hourly_rate is set -- "no rate" is a distinct honest state from "$0 owed"
  amountPaid: number;
  difference: number | null;
};

// Recomputed fresh from timeclock_entries + crew_pay_profiles + payouts
// on every call -- nothing here is stored. Incomplete sessions are
// excluded from the hours total and reported separately, never folded in
// as complete, same as v1.
export async function computeReconciliation(crewMemberId: string, from: string, to: string): Promise<ReconciliationResult> {
  const settings = await getNotificationSettings();
  const sessions = await fetchSessionsInRange({
    crewMemberId,
    from,
    to,
    dailyOvertimeHours: settings.daily_overtime_hours,
    breakRequiredAfterHours: settings.break_required_after_hours,
  });

  const complete = sessions.filter((s) => !s.incomplete);
  const hoursWorked = complete.reduce((sum, s) => sum + (s.netSeconds ?? 0) / 3600, 0);
  const incompleteSessions = sessions.length - complete.length;

  const profile = await getCrewPayProfile(crewMemberId);
  const hourlyRate = profile?.hourly_rate != null ? Number(profile.hourly_rate) : null;
  const amountOwed = hourlyRate != null ? hoursWorked * hourlyRate : null;

  const payouts = await pool.query(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM payouts WHERE crew_member_id = $1 AND paid_at >= $2 AND paid_at <= $3",
    [crewMemberId, from, to],
  );
  const amountPaid = Number(payouts.rows[0].total);
  const difference = amountOwed != null ? amountOwed - amountPaid : null;

  return { crewMemberId, hoursWorked, incompleteSessions, hourlyRate, amountOwed, amountPaid, difference };
}
