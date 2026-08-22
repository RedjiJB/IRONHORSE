import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  getAsset,
  listAssets,
  logAssetService,
  registerAsset,
  registerAssetVerificationExecutor,
  setAssetStatus,
} from "../../domain/assets.js";
import { submitForConfirmation } from "../../domain/confirmations.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const directlySettableStatusSchema = z.enum(["missing", "in_maintenance", "retired"]);

export function registerAssetTools(server: McpServer): void {
  registerAssetVerificationExecutor();

  server.registerTool(
    "register_asset",
    {
      title: "Register Asset",
      description:
        "Adds a new trackable asset to inventory. Always starts 'unconfirmed' -- there is no way to create an asset already 'available'; it must be physically verified first (see submit_asset_verification). Minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        name: z.string(),
        category: z.string().optional(),
        qrTagId: z.string().optional(),
        purchaseDate: z.string().optional(),
        condition: z.string().optional(),
        currentSiteId: z.string().uuid().optional(),
        serviceIntervalDays: z.number().int().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_asset", 3);
        const asset = await registerAsset(args);
        return { content: [{ type: "text", text: JSON.stringify(asset) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "set_asset_status",
    {
      title: "Set Asset Status",
      description:
        "Directly sets an asset's status to missing, in_maintenance, or retired. Does NOT accept 'available' -- that's only reachable through submit_asset_verification, and 'checked_out' is only entered/exited through the checkout lifecycle. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, assetId: z.string().uuid(), status: directlySettableStatusSchema }),
    },
    async ({ credentialJwt, assetId, status }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:set_asset_status", 2);
        const result = await setAssetStatus(assetId, status);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.asset) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "submit_asset_verification",
    {
      title: "Submit Asset Verification",
      description:
        "Submits a physical asset check for management review -- a crew member's own 'I checked it, it's fine' claim isn't independent verification of anything. Does not execute directly: creates a pending_confirmations row. On approval, moves the asset unconfirmed/missing/in_maintenance -> available. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, assetId: z.string().uuid(), crewMemberId: z.string().uuid() }),
    },
    async ({ credentialJwt, assetId, crewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:submit_asset_verification", 2);
        const pending = await submitForConfirmation({
          actionType: "asset_verification",
          capability: "mcp:tool:submit_asset_verification",
          summary: `Asset verification for ${assetId} by crew member ${crewMemberId}`,
          payload: { assetId, crewMemberId },
          submittedByCrewMemberId: crewMemberId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ status: "awaiting_review", pendingConfirmationId: pending.id }) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "log_asset_service",
    {
      title: "Log Asset Service",
      description: "Resets an asset's maintenance clock (last_serviced_at = now). Does not resolve any open maintenance alert. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, assetId: z.string().uuid() }),
    },
    async ({ credentialJwt, assetId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:log_asset_service", 2);
        const asset = await logAssetService(assetId);
        if (!asset) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(asset) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_assets",
    {
      title: "List Assets",
      description: "Lists assets, optionally filtered by status or category. Minimum tier: 0 (read-only).",
      inputSchema: z.object({
        ...credentialArg,
        status: z.enum(["unconfirmed", "available", "checked_out", "missing", "in_maintenance", "retired"]).optional(),
        category: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_assets", 0);
        const assets = await listAssets(filter);
        return { content: [{ type: "text", text: JSON.stringify(assets) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_asset",
    {
      title: "Get Asset",
      description: "Fetches a single asset by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_asset", 0);
        const asset = await getAsset(id);
        if (!asset) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(asset) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
