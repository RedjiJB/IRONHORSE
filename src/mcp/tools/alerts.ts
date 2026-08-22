import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { listAlerts, resolveAlert } from "../../domain/alerts.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const alertTypeSchema = z.enum([
  "idle", "delay", "wrong_site", "order_stalled", "loadout_gap", "overdue",
  "vehicle_dark", "weather", "dashboard_unreachable", "maintenance_due",
  "backup_failed", "cron_job_failed", "connectivity_degraded", "disk_space_low",
  "it_issue", "system_offline", "crew_location_stale", "crew_off_site",
]);

export function registerAlertTools(server: McpServer): void {
  server.registerTool(
    "list_alerts",
    {
      title: "List Alerts",
      description: "Lists alerts, optionally filtered by type, resolved status, or site. Minimum tier: 0 (read-only).",
      inputSchema: z.object({
        ...credentialArg,
        type: alertTypeSchema.optional(),
        resolved: z.boolean().optional(),
        siteId: z.string().uuid().optional(),
      }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_alerts", 0);
        const alerts = await listAlerts(filter);
        return { content: [{ type: "text", text: JSON.stringify(alerts) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "resolve_alert",
    {
      title: "Resolve Alert",
      description:
        "Marks an alert resolved -- a deliberate human action, never implicit. The underlying condition clearing on its own does not resolve the alert. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), resolvedByCrewMemberId: z.string().uuid() }),
    },
    async ({ credentialJwt, id, resolvedByCrewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:resolve_alert", 3);
        const result = await resolveAlert(id, { crewMemberId: resolvedByCrewMemberId });
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.alert) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
