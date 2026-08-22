import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { deactivateUser, getUser, listUsers, registerUser, resetUserPassword } from "../../domain/users.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const dashboardRoleSchema = z.enum(["admin", "staff", "owner"]);

// Managing dashboard accounts is admin/self-modifying territory -- tier 4
// across every mutation here.
export function registerUserTools(server: McpServer): void {
  server.registerTool(
    "register_user",
    {
      title: "Register Dashboard User",
      description: "Creates a new dashboard login identity with a custodially-held DID and real capability grants (dashboard:role:staff / dashboard:role:admin). Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, email: z.string().email(), name: z.string(), password: z.string().min(8), role: dashboardRoleSchema.optional() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_user", 4);
        const user = await registerUser(args);
        return { content: [{ type: "text", text: JSON.stringify(user) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "deactivate_user",
    {
      title: "Deactivate Dashboard User",
      description: "Deactivates a dashboard user -- no DELETE route exists, same as v1 (avoids orphaning resolved_by_user_id/acknowledged_by_user_id foreign keys). Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:deactivate_user", 4);
        const user = await deactivateUser(id);
        if (!user) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(user) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "reset_user_password",
    {
      title: "Reset Dashboard User Password",
      description: "Resets a dashboard user's password directly -- no current-password re-verification, same as v1 (no self-service reset flow exists). Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), newPassword: z.string().min(8) }),
    },
    async ({ credentialJwt, id, newPassword }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:reset_user_password", 4);
        const user = await resetUserPassword(id, newPassword);
        if (!user) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(user) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_users",
    {
      title: "List Dashboard Users",
      description: "Lists dashboard users, optionally filtered by active status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, active: z.boolean().optional() }),
    },
    async ({ credentialJwt, active }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_users", 0);
        const users = await listUsers({ active });
        return { content: [{ type: "text", text: JSON.stringify(users) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_user",
    {
      title: "Get Dashboard User",
      description: "Fetches a single dashboard user by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_user", 0);
        const user = await getUser(id);
        if (!user) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(user) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
