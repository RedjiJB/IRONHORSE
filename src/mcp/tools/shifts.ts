import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { assignShift, confirmShift, getShift, listShifts } from "../../domain/shifts.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const shiftStatusSchema = z.enum(["assigned", "confirmed", "declined", "no_show"]);

export function registerShiftTools(server: McpServer): void {
  server.registerTool(
    "assign_shift",
    {
      title: "Assign Shift",
      description: "Assigns a guard to a shift at a site on a given date. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        guardId: z.string().uuid(),
        siteId: z.string().uuid(),
        date: z.string(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:assign_shift", 2);
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
      title: "Confirm Or Decline Shift",
      description: "A guard confirms or declines an assigned shift. Minimum tier: 1.",
      inputSchema: z.object({
        ...credentialArg,
        shiftId: z.string().uuid(),
        decision: z.enum(["confirmed", "declined"]),
      }),
    },
    async ({ credentialJwt, shiftId, decision }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:confirm_shift", 1);
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
      description: "Lists shifts, optionally filtered by guard/site/date/status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({
        ...credentialArg,
        guardId: z.string().uuid().optional(),
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

  server.registerTool(
    "get_shift",
    {
      title: "Get Shift",
      description: "Fetches a single shift by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_shift", 0);
        const shift = await getShift(id);
        if (!shift) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(shift) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
