import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getGuard, listGuards, listGuardsWithOnDutyStatus, registerGuard } from "../../domain/guards.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const guardRoleSchema = z.enum(["guard", "supervisor", "admin"]);

export function registerGuardTools(server: McpServer): void {
  server.registerTool(
    "register_guard",
    {
      title: "Register Guard",
      description: "Registers a new guard by phone number (mobile app login identity). Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        name: z.string(),
        phone: z.string(),
        role: guardRoleSchema.optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_guard", 2);
        const guard = await registerGuard(args);
        return { content: [{ type: "text", text: JSON.stringify(guard) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_guards",
    {
      title: "List Guards",
      description: "Lists guards, optionally filtered by role/active status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, role: guardRoleSchema.optional(), active: z.boolean().optional() }),
    },
    async ({ credentialJwt, role, active }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_guards", 0);
        const guards = await listGuards({ role, active });
        return { content: [{ type: "text", text: JSON.stringify(guards) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_guard",
    {
      title: "Get Guard",
      description: "Fetches a single guard by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_guard", 0);
        const guard = await getGuard(id);
        if (!guard) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(guard) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_guards_with_on_duty_status",
    {
      title: "List Guards With On-Duty Status",
      description:
        "Lists guards along with which site (if any) they're currently on duty at, based on today's timeclock events -- basis for the supervisor live-roster view (FEATURES.md §3). Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, active: z.boolean().optional() }),
    },
    async ({ credentialJwt, active }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_guards_with_on_duty_status", 0);
        const guards = await listGuardsWithOnDutyStatus({ active });
        return { content: [{ type: "text", text: JSON.stringify(guards) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
