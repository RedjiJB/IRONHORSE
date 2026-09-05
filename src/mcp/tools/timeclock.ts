import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { listTimeclockEntries, registerTimeclockConfirmationExecutor } from "../../domain/timeclock.js";
import { submitForConfirmation } from "../../domain/confirmations.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const timeclockEventSchema = z.enum(["in", "break_start", "break_end", "out"]);

export function registerTimeclockTools(server: McpServer): void {
  registerTimeclockConfirmationExecutor();

  server.registerTool(
    "log_timeclock_event",
    {
      title: "Log Timeclock Event",
      description:
        "Submits a shift check-in/out or break event for supervisor review -- a guard's own confirmation of their hours isn't independent verification of anything. Does not execute directly: creates a pending_confirmations row. Optional lat/lng get re-verified against the site's geofence at approval time, not trusted from submission. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        guardId: z.string().uuid(),
        eventType: timeclockEventSchema,
        siteId: z.string().uuid().optional(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    },
    async ({ credentialJwt, guardId, eventType, siteId, lat, lng }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:log_timeclock_event", 2);
        const pending = await submitForConfirmation({
          actionType: "timeclock_event",
          capability: "mcp:tool:log_timeclock_event",
          summary: `${eventType} event for guard ${guardId}${siteId ? ` at site ${siteId}` : ""}`,
          payload: { guardId, eventType, siteId: siteId ?? null, lat: lat ?? null, lng: lng ?? null },
          submittedByGuardId: guardId,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ status: "awaiting_review", pendingConfirmationId: pending.id }),
            },
          ],
        };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_timeclock_entries",
    {
      title: "List Timeclock Entries",
      description: "Lists a guard's timeclock entries (already-approved events only). Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, guardId: z.string().uuid() }),
    },
    async ({ credentialJwt, guardId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_timeclock_entries", 0);
        const entries = await listTimeclockEntries(guardId);
        return { content: [{ type: "text", text: JSON.stringify(entries) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
