// Restoring BI Dashboards, Slice R: one route, five real KPIs computed
// live -- see src/domain/kpis.ts for why this isn't the vendored
// generic BI/dashboard-builder engine.
import type { Router } from "../router.js";
import { sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import {
  getOpenAlertsBySeverity,
  getCrewUtilizationToday,
  getAvgAlertResolutionTime,
  getPoSpendThisMonthByVendor,
  getTimeclockHoursThisWeek,
} from "../../domain/kpis.js";

export function registerKpiRoutes(router: Router): void {
  router.get("/api/v1/bi/kpis", async (req, res) => {
    try {
      await requireStaffRole(req);
      const [openAlerts, crewUtilization, avgResolution, poSpend, timeclockHours] = await Promise.all([
        getOpenAlertsBySeverity(),
        getCrewUtilizationToday(),
        getAvgAlertResolutionTime(),
        getPoSpendThisMonthByVendor(),
        getTimeclockHoursThisWeek(),
      ]);
      sendJson(res, 200, {
        open_alerts: openAlerts,
        crew_utilization: crewUtilization,
        avg_alert_resolution: avgResolution,
        po_spend_this_month: poSpend,
        timeclock_hours_this_week: timeclockHours,
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
