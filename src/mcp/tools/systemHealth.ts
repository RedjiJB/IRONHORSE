import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  reportBackupStatus,
  reportConnectivityHealth,
  reportCronFailure,
  reportDashboardHealth,
  reportDiskHealth,
  reportItIssue,
  reportOfflineRecovery,
} from "../../domain/systemHealth.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

// These are ingestion points for a deployment's own infra scripts (a
// host-side heartbeat, a nightly backup job) -- tier 4 (admin) since only
// such trusted infra would ever hold a credential capable of calling
// them, not a regular dispatch/crew-facing agent.
export function registerSystemHealthTools(server: McpServer): void {
  server.registerTool(
    "report_backup_status",
    {
      title: "Report Backup Status",
      description: "Reports the nightly backup job's outcome. Success resets the staleness clock and raises nothing. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, success: z.boolean() }),
    },
    async ({ credentialJwt, success }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_backup_status", 4);
        const result = await reportBackupStatus(success);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "report_dashboard_health",
    {
      title: "Report Dashboard Health",
      description: "Reports whether the public dashboard URL is reachable. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, reachable: z.boolean() }),
    },
    async ({ credentialJwt, reachable }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_dashboard_health", 4);
        const result = await reportDashboardHealth(reachable);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "report_connectivity_health",
    {
      title: "Report Connectivity Health",
      description: "Reports a host-side connectivity check result. Never auto-resolves -- a human must confirm recovery. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, degraded: z.boolean() }),
    },
    async ({ credentialJwt, degraded }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_connectivity_health", 4);
        const result = await reportConnectivityHealth(degraded);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "report_disk_health",
    {
      title: "Report Disk Health",
      description: "Reports a host-side disk space check result. Never auto-resolves. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, low: z.boolean() }),
    },
    async ({ credentialJwt, low }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_disk_health", 4);
        const result = await reportDiskHealth(low);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "report_it_issue",
    {
      title: "Report IT Issue",
      description: "Crew-initiated freeform IT issue report -- no confirm-before-execute gate, same as other safety-style reports. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, summary: z.string() }),
    },
    async ({ credentialJwt, summary }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_it_issue", 2);
        const result = await reportItIssue(summary);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "report_cron_failure",
    {
      title: "Report Cron Failure",
      description: "Reports a scheduled agent job's total failure, without leaking raw error internals to the alert text. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, jobName: z.string() }),
    },
    async ({ credentialJwt, jobName }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_cron_failure", 4);
        const result = await reportCronFailure(jobName);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "report_offline_recovery",
    {
      title: "Report Offline Recovery",
      description:
        "Backfills a purely historical system_offline record once recovery from a backend/Postgres outage is confirmed -- this alert type structurally can never be raised live. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, offlineSince: z.string(), recoveredAt: z.string() }),
    },
    async ({ credentialJwt, offlineSince, recoveredAt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:report_offline_recovery", 4);
        const result = await reportOfflineRecovery(new Date(offlineSince), new Date(recoveredAt));
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
