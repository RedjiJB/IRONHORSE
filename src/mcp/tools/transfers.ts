import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { advanceTransferStatus, createTransfer, listTransfers } from "../../domain/transfers.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const transferStatusSchema = z.enum(["requested", "in_transit", "completed", "cancelled"]);

export function registerTransferTools(server: McpServer): void {
  server.registerTool(
    "create_transfer",
    {
      title: "Create Transfer",
      description:
        "Requests a direct site-to-site move of an asset, bypassing a depot. Requires the asset's currently recorded site to actually equal fromSiteId. Real logistics authority. Minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        assetId: z.string().uuid(),
        fromSiteId: z.string().uuid(),
        toSiteId: z.string().uuid(),
        requestedBy: z.string().uuid(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:create_transfer", 3);
        const result = await createTransfer(args);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.transfer) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "advance_transfer_status",
    {
      title: "Advance Transfer Status",
      description:
        "Moves a transfer forward through requested->in_transit->completed, or cancels it from any non-terminal status. Only completing a transfer actually updates the asset's recorded site. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, transferId: z.string().uuid(), status: transferStatusSchema }),
    },
    async ({ credentialJwt, transferId, status }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:advance_transfer_status", 3);
        const result = await advanceTransferStatus(transferId, status);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.transfer) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_transfers",
    {
      title: "List Transfers",
      description: "Lists transfers, optionally filtered by asset or status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, assetId: z.string().uuid().optional(), status: transferStatusSchema.optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_transfers", 0);
        const transfers = await listTransfers(filter);
        return { content: [{ type: "text", text: JSON.stringify(transfers) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
