import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { assignShift, confirmShift, listShifts } from "../../domain/shifts.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const shiftStatusSchema = z.enum(["assigned", "confirmed", "declined", "no_show"]);

export function registerShiftTools(server: McpServer): void {
  server.registerTool(
    "assign_shift",
    {
      title: "Assign Shift",
      description:
        "Assigns a crew member to a site on a given date. Real scheduling authority -- minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        crewMemberId: z.string().uuid(),
        siteId: z.string().uuid(),
        date: z.string().describe("ISO date, e.g. 2026-08-22"),
        startTime: z.string().optional().describe("HH:MM"),
        endTime: z.string().optional().describe("HH:MM"),
        jobId: z.string().uuid().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:assign_shift", 3);
        const shift = await assignShift(args);
        return { content: [{ type: "text", text: JSON.stringify(shift) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "confirm_shift",
    {
      title: "Confirm or Decline Shift",
      description:
        "A crew member confirming or declining their own already-assigned shift -- acting on their own affairs, not exercising scheduling authority. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        shiftId: z.string().uuid(),
        decision: z.enum(["confirmed", "declined"]),
      }),
    },
    async ({ credentialJwt, shiftId, decision }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:confirm_shift", 2);
        const shift = await confirmShift(shiftId, decision);
        if (!shift) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(shift) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_shifts",
    {
      title: "List Shifts",
      description: "Lists shifts, optionally filtered by crew member, site, date, or status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({
        ...credentialArg,
        crewMemberId: z.string().uuid().optional(),
        siteId: z.string().uuid().optional(),
        date: z.string().optional(),
        status: shiftStatusSchema.optional(),
      }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_shifts", 0);
        const shifts = await listShifts(filter);
        return { content: [{ type: "text", text: JSON.stringify(shifts) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
