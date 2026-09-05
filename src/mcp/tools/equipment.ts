import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  checkOutEquipment,
  getEquipment,
  listEquipment,
  listEquipmentCheckouts,
  registerEquipment,
  registerEquipmentReturnExecutor,
  setEquipmentStatus,
} from "../../domain/equipment.js";
import { submitForConfirmation } from "../../domain/confirmations.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const equipmentStatusSchema = z.enum(["available", "checked_out", "in_maintenance", "missing", "retired"]);
const directlySettableStatusSchema = z.enum(["missing", "in_maintenance", "retired"]);

export function registerEquipmentTools(server: McpServer): void {
  registerEquipmentReturnExecutor();

  server.registerTool(
    "register_equipment",
    {
      title: "Register Equipment",
      description: "Registers a piece of equipment (weapon, radio, vest, etc.), starting 'available'. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        name: z.string(),
        category: z.string(),
        serialNumber: z.string().optional(),
        siteId: z.string().uuid().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_equipment", 2);
        const equipment = await registerEquipment(args);
        return { content: [{ type: "text", text: JSON.stringify(equipment) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "set_equipment_status",
    {
      title: "Set Equipment Status",
      description: "Directly sets equipment status to missing/in_maintenance/retired -- not available/checked_out, which only change through the checkout lifecycle. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), status: directlySettableStatusSchema }),
    },
    async ({ credentialJwt, id, status }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:set_equipment_status", 2);
        const result = await setEquipmentStatus(id, status);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.equipment) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_equipment",
    {
      title: "List Equipment",
      description: "Lists equipment, optionally filtered by status/category. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, status: equipmentStatusSchema.optional(), category: z.string().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_equipment", 0);
        const equipment = await listEquipment(filter);
        return { content: [{ type: "text", text: JSON.stringify(equipment) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_equipment",
    {
      title: "Get Equipment",
      description: "Fetches a single equipment item by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_equipment", 0);
        const equipment = await getEquipment(id);
        if (!equipment) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(equipment) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "check_out_equipment",
    {
      title: "Check Out Equipment",
      description: "Issues an available piece of equipment to a guard -- structurally impossible to double-issue the same item. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        equipmentId: z.string().uuid(),
        guardId: z.string().uuid(),
        expectedReturnAt: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:check_out_equipment", 2);
        const result = await checkOutEquipment(args);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.checkout) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "submit_equipment_return",
    {
      title: "Submit Equipment Return",
      description:
        "A guard submits an equipment return (with condition/damage report) for supervisor review -- a guard's own condition claim isn't independent verification, same reasoning as timeclock events. Does not execute directly: creates a pending_confirmations row (FEATURES.md §2's 'signature confirmation'). Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        checkoutId: z.string().uuid(),
        returnedByGuardId: z.string().uuid(),
        conditionFlag: z.boolean().optional(),
        conditionNote: z.string().optional(),
      }),
    },
    async ({ credentialJwt, checkoutId, returnedByGuardId, conditionFlag, conditionNote }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:submit_equipment_return", 2);
        const pending = await submitForConfirmation({
          actionType: "equipment_return",
          capability: "mcp:tool:submit_equipment_return",
          summary: `Equipment return for checkout ${checkoutId}${conditionFlag ? " (condition issue reported)" : ""}`,
          payload: { checkoutId, returnedByGuardId, conditionFlag: conditionFlag ?? false, conditionNote: conditionNote ?? null },
          submittedByGuardId: returnedByGuardId,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ status: "awaiting_review", pendingConfirmationId: pending.id }) }],
        };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_equipment_checkouts",
    {
      title: "List Equipment Checkouts",
      description: "Lists equipment checkouts, optionally filtered by equipment/outstanding. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, equipmentId: z.string().uuid().optional(), outstanding: z.boolean().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_equipment_checkouts", 0);
        const checkouts = await listEquipmentCheckouts(filter);
        return { content: [{ type: "text", text: JSON.stringify(checkouts) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
