// Restoring BI Dashboards, Slice R: a fixed page of real, live-computed
// KPIs -- not the vendored generic BI/KPI-definition/dashboard-builder/
// scheduled-report/alert-rule engine (2685 lines, an entire analytics
// platform). No formula DSL, no persistence -- one function per KPI,
// each a real query against this domain's own data.
import { listAlerts } from "./alerts.js";
import { listCrewMembers } from "./crewMembers.js";
import { listPurchaseOrders } from "./purchaseOrders.js";
import { getVendor } from "./vendors.js";
import { fetchSessionsInRange } from "./timeclockSessions.js";
import { getNotificationSettings } from "./notificationSettings.js";
import { pool } from "../db/pool.js";

export type OpenAlertsBySeverity = { critical: number; routine: number };

export async function getOpenAlertsBySeverity(): Promise<OpenAlertsBySeverity> {
  const open = await listAlerts({ resolved: false });
  return {
    critical: open.filter((a) => a.severity === "critical").length,
    routine: open.filter((a) => a.severity === "routine").length,
  };
}

export type CrewUtilization = { clocked_in_today: number; active_crew: number; utilization_pct: number | null };

export async function getCrewUtilizationToday(): Promise<CrewUtilization> {
  const [activeCrew, clockedInResult] = await Promise.all([
    listCrewMembers({ active: true }),
    pool.query(
      `SELECT COUNT(DISTINCT crew_member_id)::int AS n FROM timeclock_entries
       WHERE event_type = 'in' AND "timestamp" >= date_trunc('day', now())`,
    ),
  ]);
  const clockedInToday = clockedInResult.rows[0].n as number;
  const activeCount = activeCrew.length;
  return {
    clocked_in_today: clockedInToday,
    active_crew: activeCount,
    utilization_pct: activeCount > 0 ? Math.round((clockedInToday / activeCount) * 1000) / 10 : null,
  };
}

export type AvgAlertResolutionTime = { avg_resolution_hours: number | null; resolved_count: number };

// Last 30 days -- an unbounded "average over all alerts ever" has no
// natural stopping point in a live event table, same reasoning every
// other rolling-window query in this project gives.
export async function getAvgAlertResolutionTime(): Promise<AvgAlertResolutionTime> {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS resolved_count,
       AVG(EXTRACT(EPOCH FROM (resolved_at - raised_at)) / 3600.0) AS avg_hours
     FROM alerts
     WHERE resolved_at IS NOT NULL AND raised_at >= now() - interval '30 days'`,
  );
  const row = result.rows[0] as { resolved_count: number; avg_hours: string | null };
  return {
    resolved_count: row.resolved_count,
    avg_resolution_hours: row.avg_hours !== null ? Math.round(Number(row.avg_hours) * 10) / 10 : null,
  };
}

export type PoSpendByVendor = { vendor_id: string | null; vendor_name: string; total_cost: number }[];

export async function getPoSpendThisMonthByVendor(): Promise<PoSpendByVendor> {
  const allPos = await listPurchaseOrders();
  const now = new Date();
  const thisMonth = allPos.filter((po) => {
    const created = new Date(po.created_at);
    return created.getUTCFullYear() === now.getUTCFullYear() && created.getUTCMonth() === now.getUTCMonth();
  });

  const totals = new Map<string, number>();
  for (const po of thisMonth) {
    const key = po.vendor_id ?? "__none__";
    totals.set(key, (totals.get(key) ?? 0) + Number(po.cost ?? 0));
  }

  const rows: PoSpendByVendor = [];
  for (const [key, total] of totals) {
    if (key === "__none__") {
      rows.push({ vendor_id: null, vendor_name: "No vendor", total_cost: total });
      continue;
    }
    const vendor = await getVendor(key);
    rows.push({ vendor_id: key, vendor_name: vendor?.name ?? "Unknown vendor", total_cost: total });
  }
  return rows.sort((a, b) => b.total_cost - a.total_cost);
}

export type TimeclockHoursThisWeek = { total_hours: number };

export async function getTimeclockHoursThisWeek(): Promise<TimeclockHoursThisWeek> {
  const settings = await getNotificationSettings();
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday));

  const sessions = await fetchSessionsInRange({
    from: weekStart.toISOString(),
    to: now.toISOString(),
    dailyOvertimeHours: settings.daily_overtime_hours,
    breakRequiredAfterHours: settings.break_required_after_hours,
  });
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.netSeconds ?? 0), 0);
  return { total_hours: Math.round((totalSeconds / 3600) * 10) / 10 };
}
