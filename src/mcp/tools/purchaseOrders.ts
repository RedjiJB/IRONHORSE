import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  compilePurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrderItems,
  listPurchaseOrders,
  registerPurchaseOrderFulfillmentExecutor,
  sendPurchaseOrder,
} from "../../domain/purchaseOrders.js";
import { submitForConfirmation } from "../../domain/confirmations.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerPurchaseOrderTools(server: McpServer): void {
  registerPurchaseOrderFulfillmentExecutor();

  server.registerTool(
    "compile_purchase_order",
    {
      title: "Compile Purchase Order",
      description: "Flattens an order's line items into a new purchase order. Fails if the order has no items. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, orderId: z.string().uuid(), vendorId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, orderId, vendorId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:compile_purchase_order", 3);
        const result = await compilePurchaseOrder(orderId, vendorId);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.purchaseOrder) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "send_purchase_order",
    {
      title: "Send Purchase Order",
      description: "Sends a compiled purchase order to a human contact (an office address or a picker). Only legal from status 'compiled'. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, purchaseOrderId: z.string().uuid(), sentTo: z.string() }),
    },
    async ({ credentialJwt, purchaseOrderId, sentTo }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:send_purchase_order", 3);
        const result = await sendPurchaseOrder(purchaseOrderId, sentTo);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.purchaseOrder) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "submit_purchase_order_fulfillment",
    {
      title: "Submit Purchase Order Fulfillment",
      description:
        "Submits a delivery-receipt claim ('it arrived') for management review -- not independently verifiable from the crew member's own report alone. Does not execute directly: creates a pending_confirmations row. Only legal from status 'sent_to_office' or 'forwarded_by_office'. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, purchaseOrderId: z.string().uuid(), crewMemberId: z.string().uuid() }),
    },
    async ({ credentialJwt, purchaseOrderId, crewMemberId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:submit_purchase_order_fulfillment", 2);
        const pending = await submitForConfirmation({
          actionType: "purchase_order_fulfillment",
          capability: "mcp:tool:submit_purchase_order_fulfillment",
          summary: `Delivery claim for purchase order ${purchaseOrderId} by crew member ${crewMemberId}`,
          payload: { purchaseOrderId, crewMemberId },
          submittedByCrewMemberId: crewMemberId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ status: "awaiting_review", pendingConfirmationId: pending.id }) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_purchase_orders",
    {
      title: "List Purchase Orders",
      description: "Lists purchase orders, optionally filtered by status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({
        ...credentialArg,
        status: z.enum(["compiled", "sent_to_office", "forwarded_by_office", "fulfilled", "cancelled"]).optional(),
      }),
    },
    async ({ credentialJwt, status }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_purchase_orders", 0);
        const purchaseOrders = await listPurchaseOrders({ status });
        return { content: [{ type: "text", text: JSON.stringify(purchaseOrders) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_purchase_order",
    {
      title: "Get Purchase Order",
      description: "Fetches a single purchase order by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_purchase_order", 0);
        const purchaseOrder = await getPurchaseOrder(id);
        if (!purchaseOrder) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(purchaseOrder) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_purchase_order_items",
    {
      title: "List Purchase Order Items",
      description: "Lists a purchase order's line items. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, purchaseOrderId: z.string().uuid() }),
    },
    async ({ credentialJwt, purchaseOrderId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_purchase_order_items", 0);
        const items = await listPurchaseOrderItems(purchaseOrderId);
        return { content: [{ type: "text", text: JSON.stringify(items) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
