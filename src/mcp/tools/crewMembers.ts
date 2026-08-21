import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getCrewMember, listCrewMembers, registerCrewMember } from "../../domain/crewMembers.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const crewRoleSchema = z.enum(["crew", "foreman", "yard", "management", "owner", "IT"]);

export function registerCrewMemberTools(server: McpServer): void {
  server.registerTool(
    "register_crew_member",
    {
      title: "Register Crew Member",
      description: "Registers a new crew member by phone number (WhatsApp identity). Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        name: z.string(),
        phone: z.string(),
        role: crewRoleSchema.optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_crew_member", 2);
        const crewMember = await registerCrewMember(args);
        return { content: [{ type: "text", text: JSON.stringify(crewMember) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_crew_members",
    {
      title: "List Crew Members",
      description: "Lists crew members, optionally filtered by role/active status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, role: crewRoleSchema.optional(), active: z.boolean().optional() }),
    },
    async ({ credentialJwt, role, active }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_crew_members", 0);
        const crew = await listCrewMembers({ role, active });
        return { content: [{ type: "text", text: JSON.stringify(crew) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_crew_member",
    {
      title: "Get Crew Member",
      description: "Fetches a single crew member by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_crew_member", 0);
        const crewMember = await getCrewMember(id);
        if (!crewMember) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(crewMember) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
