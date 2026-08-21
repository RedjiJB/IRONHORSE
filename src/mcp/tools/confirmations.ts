import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { approveConfirmation, listPendingConfirmations, rejectConfirmation } from "../../domain/confirmations.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerConfirmationTools(server: McpServer): void {
  server.registerTool(
    "list_pending_confirmations",
    {
      title: "List Pending Confirmations",
      description: "Lists every action awaiting management review. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_pending_confirmations", 2);
        const pending = await listPendingConfirmations();
        return { content: [{ type: "text", text: JSON.stringify(pending) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "approve_pending_confirmation",
    {
      title: "Approve Pending Confirmation",
      description:
        "Approves a pending action and actually executes it -- the reviewer must hold crew role 'management' or 'owner' (checked against reviewerCrewMemberId, not the calling agent's tier alone). Re-validates against current state, not state at submission time. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), reviewerCrewMemberId: z.string().uuid() }),
    },
    async ({ credentialJwt, id, reviewerCrewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:approve_pending_confirmation", 3);
        const result = await approveConfirmation(id, reviewerCrewMemberId);
        if (!result.ok) return { content: [{ type: "text", text: `Rejected: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.confirmation) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "reject_pending_confirmation",
    {
      title: "Reject Pending Confirmation",
      description:
        "Rejects a pending action without executing it -- same reviewer-role check as approval. Minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        id: z.string().uuid(),
        reviewerCrewMemberId: z.string().uuid(),
        note: z.string().optional(),
      }),
    },
    async ({ credentialJwt, id, reviewerCrewMemberId, note }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:reject_pending_confirmation", 3);
        const result = await rejectConfirmation(id, reviewerCrewMemberId, note);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.confirmation) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
