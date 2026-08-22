import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { createCheckout, listCheckouts, listOverdueCheckouts, registerCheckoutReturnExecutor } from "../../domain/checkouts.js";
import { submitForConfirmation } from "../../domain/confirmations.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerCheckoutTools(server: McpServer): void {
  registerCheckoutReturnExecutor();

  server.registerTool(
    "create_checkout",
    {
      title: "Create Checkout",
      description:
        "Checks an available asset out to a crew member -- transactional with a row lock, so double-checkout of the same asset is structurally impossible. Real logistics authority. Minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        assetId: z.string().uuid(),
        checkedOutBy: z.string().uuid(),
        orderId: z.string().uuid().optional(),
        expectedReturnAt: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:create_checkout", 3);
        const result = await createCheckout(args);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.checkout) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "submit_checkout_return",
    {
      title: "Submit Checkout Return",
      description:
        "Submits a checkout return, including any damage/condition claim, for management review -- a crew member's own damage report isn't independent verification of anything. Does not execute directly: creates a pending_confirmations row. A damaged return routes the asset to in_maintenance, not back to available. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        checkoutId: z.string().uuid(),
        returnedBy: z.string().uuid(),
        damageFlag: z.boolean().optional(),
        damageNote: z.string().optional(),
        photoUrl: z.string().optional(),
      }),
    },
    async ({ credentialJwt, checkoutId, returnedBy, damageFlag, damageNote, photoUrl }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:submit_checkout_return", 2);
        const pending = await submitForConfirmation({
          actionType: "checkout_return",
          capability: "mcp:tool:submit_checkout_return",
          summary: `Return of checkout ${checkoutId} by crew member ${returnedBy}${damageFlag ? " (damage reported)" : ""}`,
          payload: { checkoutId, returnedBy, damageFlag: damageFlag ?? false, damageNote: damageNote ?? null, photoUrl: photoUrl ?? null },
          submittedByCrewMemberId: returnedBy,
        });
        return { content: [{ type: "text", text: JSON.stringify({ status: "awaiting_review", pendingConfirmationId: pending.id }) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_checkouts",
    {
      title: "List Checkouts",
      description: "Lists checkouts, optionally filtered by asset or outstanding-only. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, assetId: z.string().uuid().optional(), outstanding: z.boolean().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_checkouts", 0);
        const checkouts = await listCheckouts(filter);
        return { content: [{ type: "text", text: JSON.stringify(checkouts) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_overdue_checkouts",
    {
      title: "List Overdue Checkouts",
      description: "Lists checkouts outstanding past their expected_return_at. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_overdue_checkouts", 0);
        const checkouts = await listOverdueCheckouts();
        return { content: [{ type: "text", text: JSON.stringify(checkouts) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
