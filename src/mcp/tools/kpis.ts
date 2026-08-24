import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  getAvgAlertResolutionTime,
  getCrewUtilizationToday,
  getOpenAlertsBySeverity,
  getPoSpendThisMonthByVendor,
  getTimeclockHoursThisWeek,
} from "../../domain/kpis.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

// One combined tool, not five -- these five KPIs are always consumed
// together (same shape as the BI dashboard's own GET /api/v1/bi/kpis
// façade route). Tier 3: company-wide spend/utilization/payroll-hours
// figures are management-level insight, not something a crew-tier
// WhatsApp sender should be able to pull.
export function registerKpiTools(server: McpServer): void {
  server.registerTool(
    "get_kpis",
    {
      title: "Get KPIs",
      description:
        "Fixed set of five live-computed KPIs: open alerts by severity, crew utilization today, average alert resolution time (30d), PO spend this month by vendor, timeclock hours this week. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_kpis", 3);
        const [openAlerts, crewUtilization, avgResolution, poSpend, timeclockHours] = await Promise.all([
          getOpenAlertsBySeverity(),
          getCrewUtilizationToday(),
          getAvgAlertResolutionTime(),
          getPoSpendThisMonthByVendor(),
          getTimeclockHoursThisWeek(),
        ]);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                openAlertsBySeverity: openAlerts,
                crewUtilizationToday: crewUtilization,
                avgAlertResolutionTime: avgResolution,
                poSpendThisMonthByVendor: poSpend,
                timeclockHoursThisWeek: timeclockHours,
              }),
            },
          ],
        };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
