import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { assignShift, confirmShift, getShift, listShifts, reassignShift } from "../../domain/shifts.js";
import { checkGuardPostCompliance } from "../../domain/certifications.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const shiftStatusSchema = z.enum(["assigned", "confirmed", "declined", "no_show", "reassigned"]);

export function registerShiftTools(server: McpServer): void {
  server.registerTool(
    "assign_shift",
    {
      title: "Assign Shift",
      description:
        "Assigns a guard to a shift at a site on a given date, optionally tied to a post. If postId is set, also returns a soft complianceWarning (missing/expired required certs) -- never blocks the assignment (DOMAIN-DESIGN.md §5's resolved soft-flag decision). Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        guardId: z.string().uuid(),
        siteId: z.string().uuid(),
        date: z.string(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
        postId: z.string().uuid().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:assign_shift", 2);
        const shift = await assignShift(args);
        const complianceWarning = args.postId
          ? await checkGuardPostCompliance(args.guardId, args.postId, args.date)
          : null;
        return { content: [{ type: "text", text: JSON.stringify({ ...shift, complianceWarning }) }] };
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
    "reassign_shift",
    {
      title: "Reassign Shift",
      description:
        "Overrides/reassigns a shift on the fly: marks the outgoing shift no_show or reassigned and creates a fresh shift for the replacement guard at the same site/date/time/post, linked back for an audit trail. If the shift has a postId, also returns a soft complianceWarning for the new guard -- never blocks (DOMAIN-DESIGN.md §5). Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        shiftId: z.string().uuid(),
        newGuardId: z.string().uuid(),
        outgoingStatus: z.enum(["no_show", "reassigned"]),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:reassign_shift", 2);
        const result = await reassignShift(args);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        const complianceWarning = result.newShift.post_id
          ? await checkGuardPostCompliance(args.newGuardId, result.newShift.post_id, result.newShift.date)
          : null;
        return { content: [{ type: "text", text: JSON.stringify({ oldShift: result.oldShift, newShift: result.newShift, complianceWarning }) }] };
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
