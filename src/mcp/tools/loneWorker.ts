import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { checkIn, listCheckins, listOverdueLoneWorkers } from "../../domain/loneWorker.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerLoneWorkerTools(server: McpServer): void {
  server.registerTool(
    "lone_worker_check_in",
    {
      title: "Lone Worker Check In",
      description:
        "A guard checks in against their own shift, setting when the next check-in is due. Minimum tier: 1.",
      inputSchema: z.object({
        ...credentialArg,
        shiftId: z.string().uuid(),
        guardId: z.string().uuid(),
        intervalMinutes: z.number().int().positive(),
        lat: z.number().optional(),
        lng: z.number().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:lone_worker_check_in", 1);
        const result = await checkIn(args);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.checkin) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_lone_worker_checkins",
    {
      title: "List Lone Worker Checkins",
      description: "Lists lone-worker check-ins, optionally filtered by shift and/or guard. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, shiftId: z.string().uuid().optional(), guardId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_lone_worker_checkins", 0);
        const checkins = await listCheckins(filter);
        return { content: [{ type: "text", text: JSON.stringify(checkins) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_overdue_lone_workers",
    {
      title: "List Overdue Lone Workers",
      description:
        "Lists confirmed shifts whose most recent check-in is now overdue. Visibility only -- no active alerting poller yet. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_overdue_lone_workers", 0);
        const overdue = await listOverdueLoneWorkers();
        return { content: [{ type: "text", text: JSON.stringify(overdue) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
