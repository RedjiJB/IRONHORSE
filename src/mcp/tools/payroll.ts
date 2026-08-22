import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { computeReconciliation, getCrewPayProfile, listPayouts, recordPayout, setCrewPayProfile } from "../../domain/payroll.js";
import { fetchSessionsInRange } from "../../domain/timeclockSessions.js";
import { getNotificationSettings } from "../../domain/notificationSettings.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerPayrollTools(server: McpServer): void {
  server.registerTool(
    "set_crew_pay_profile",
    {
      title: "Set Crew Pay Profile",
      description: "Sets a crew member's pay type and hourly rate -- 'what someone is paid', independent of 'what they were actually paid' (payouts). Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid(), payType: z.enum(["payroll", "cash"]).optional(), hourlyRate: z.number().nonnegative().optional() }),
    },
    async ({ credentialJwt, crewMemberId, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:set_crew_pay_profile", 4);
        const profile = await setCrewPayProfile(crewMemberId, args);
        return { content: [{ type: "text", text: JSON.stringify(profile) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_crew_pay_profile",
    {
      title: "Get Crew Pay Profile",
      description: "Fetches a crew member's pay profile. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid() }),
    },
    async ({ credentialJwt, crewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_crew_pay_profile", 0);
        const profile = await getCrewPayProfile(crewMemberId);
        return { content: [{ type: "text", text: JSON.stringify(profile) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "record_payout",
    {
      title: "Record Payout",
      description: "Manually logs that a crew member was actually paid -- the app never moves money, this is a record of a payment made outside the system. Always a dashboard admin. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid(), amount: z.number().positive(), note: z.string().optional(), recordedByUserId: z.string().uuid(), paidAt: z.string().optional() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:record_payout", 4);
        const payout = await recordPayout(args);
        return { content: [{ type: "text", text: JSON.stringify(payout) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_payouts",
    {
      title: "List Payouts",
      description: "Lists payouts, optionally filtered by crew member. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, crewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_payouts", 0);
        const payouts = await listPayouts({ crewMemberId });
        return { content: [{ type: "text", text: JSON.stringify(payouts) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_payroll_reconciliation",
    {
      title: "Get Payroll Reconciliation",
      description: "Computes hours worked x hourly rate vs. actual payouts for a crew member over a date range -- recomputed fresh every call, nothing stored. amount_owed is null (not 0) when no hourly_rate is set. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid(), from: z.string(), to: z.string() }),
    },
    async ({ credentialJwt, crewMemberId, from, to }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_payroll_reconciliation", 4);
        const result = await computeReconciliation(crewMemberId, from, to);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_timeclock_sessions",
    {
      title: "List Timeclock Sessions",
      description:
        "Derives real in/break/out sessions from raw timeclock events over a date range, including per-session overtime/missed_break flags (payroll-review signal only, never paged) -- the data backing a Timesheets export. Minimum tier: 0 (read-only, matching v1's unscoped route).",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid().optional(), from: z.string(), to: z.string() }),
    },
    async ({ credentialJwt, crewMemberId, from, to }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_timeclock_sessions", 0);
        const settings = await getNotificationSettings();
        const sessions = await fetchSessionsInRange({
          crewMemberId,
          from,
          to,
          dailyOvertimeHours: settings.daily_overtime_hours,
          breakRequiredAfterHours: settings.break_required_after_hours,
        });
        return { content: [{ type: "text", text: JSON.stringify(sessions) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
