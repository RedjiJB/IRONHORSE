import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  addOrderItem,
  advanceOrderStatus,
  createOrder,
  getOrder,
  listOrderItems,
  listOrders,
  setOrderItemUnitCost,
} from "../../domain/orders.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const orderStatusSchema = z.enum(["requested", "confirmed", "picked", "loaded", "in_field", "returned", "cancelled"]);

export function registerOrderTools(server: McpServer): void {
  server.registerTool(
    "create_order",
    {
      title: "Create Order",
      description: "Creates a crew request for equipment/materials. Requesting isn't scheduling authority over others -- minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        requesterId: z.string().uuid(),
        siteId: z.string().uuid().optional(),
        dateNeeded: z.string().optional(),
        specNotes: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:create_order", 2);
        const order = await createOrder(args);
        return { content: [{ type: "text", text: JSON.stringify(order) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "add_order_item",
    {
      title: "Add Order Item",
      description: "Adds one asset or consumable line to an order -- exactly one of assetId/consumableId must be set. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        orderId: z.string().uuid(),
        assetId: z.string().uuid().optional(),
        consumableId: z.string().uuid().optional(),
        quantity: z.number().positive(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:add_order_item", 2);
        const item = await addOrderItem(args);
        return { content: [{ type: "text", text: JSON.stringify(item) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "set_order_item_unit_cost",
    {
      title: "Set Order Item Unit Cost",
      description: "Sets the real transaction price actually paid for an order line -- operational cost data, same tier as PO cost. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, orderItemId: z.string().uuid(), unitCost: z.number().nonnegative() }),
    },
    async ({ credentialJwt, orderItemId, unitCost }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:set_order_item_unit_cost", 3);
        const item = await setOrderItemUnitCost(orderItemId, unitCost);
        if (!item) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(item) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "advance_order_status",
    {
      title: "Advance Order Status",
      description:
        "Moves an order forward through requested->confirmed->picked->loaded->in_field->returned, or cancels it from any non-terminal status. No skipping back, no re-entering an earlier status. Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, orderId: z.string().uuid(), status: orderStatusSchema }),
    },
    async ({ credentialJwt, orderId, status }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:advance_order_status", 3);
        const result = await advanceOrderStatus(orderId, status);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.order) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      title: "List Orders",
      description: "Lists orders, optionally filtered by status or requester. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, status: orderStatusSchema.optional(), requesterId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_orders", 0);
        const orders = await listOrders(filter);
        return { content: [{ type: "text", text: JSON.stringify(orders) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      title: "Get Order",
      description: "Fetches a single order by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_order", 0);
        const order = await getOrder(id);
        if (!order) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(order) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_order_items",
    {
      title: "List Order Items",
      description: "Lists an order's line items. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, orderId: z.string().uuid() }),
    },
    async ({ credentialJwt, orderId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_order_items", 0);
        const items = await listOrderItems(orderId);
        return { content: [{ type: "text", text: JSON.stringify(items) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
