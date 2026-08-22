import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  adjustMoneyInstrumentBalance,
  assignCustody,
  endCustody,
  getCurrentCustody,
  listMoneyInstruments,
  registerMoneyInstrument,
} from "../../domain/moneyInstruments.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const instrumentTypeSchema = z.enum(["company_card", "petty_cash"]);

export function registerMoneyInstrumentTools(server: McpServer): void {
  server.registerTool(
    "register_money_instrument",
    {
      title: "Register Money Instrument",
      description: "Adds a company card or petty cash float. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, type: instrumentTypeSchema, label: z.string(), initialBalance: z.number().optional() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_money_instrument", 4);
        const instrument = await registerMoneyInstrument(args);
        return { content: [{ type: "text", text: JSON.stringify(instrument) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "adjust_money_instrument_balance",
    {
      title: "Adjust Money Instrument Balance",
      description: "Applies a signed delta to a petty_cash instrument's hand-tracked balance -- never auto-derived from spend_records. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), delta: z.number() }),
    },
    async ({ credentialJwt, id, delta }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:adjust_money_instrument_balance", 4);
        const result = await adjustMoneyInstrumentBalance(id, delta);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.instrument) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "assign_custody",
    {
      title: "Assign Instrument Custody",
      description: "Assigns who currently holds a money instrument. Does not automatically end any prior custody period -- caller's responsibility, same as v1. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, instrumentId: z.string().uuid(), heldBy: z.string().uuid(), assignedByUserId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:assign_custody", 4);
        const custody = await assignCustody(args);
        return { content: [{ type: "text", text: JSON.stringify(custody) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "end_custody",
    {
      title: "End Instrument Custody",
      description: "Ends a custody period. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, custodyId: z.string().uuid() }),
    },
    async ({ credentialJwt, custodyId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:end_custody", 4);
        const custody = await endCustody(custodyId);
        if (!custody) return { content: [{ type: "text", text: "Not found or already ended" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(custody) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_money_instruments",
    {
      title: "List Money Instruments",
      description: "Lists money instruments, optionally filtered by active status. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, active: z.boolean().optional() }),
    },
    async ({ credentialJwt, active }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_money_instruments", 0);
        const instruments = await listMoneyInstruments({ active });
        return { content: [{ type: "text", text: JSON.stringify(instruments) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_current_custody",
    {
      title: "Get Current Custody",
      description: "Fetches who currently holds a money instrument, if anyone. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, instrumentId: z.string().uuid() }),
    },
    async ({ credentialJwt, instrumentId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_current_custody", 0);
        const custody = await getCurrentCustody(instrumentId);
        return { content: [{ type: "text", text: JSON.stringify(custody) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
