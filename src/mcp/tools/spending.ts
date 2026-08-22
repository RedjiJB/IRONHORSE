import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  approveSpendRecord,
  disputeSpendRecord,
  listMissingReceipts,
  listSpendRecords,
  registerSpendRecord,
  rejectSpendRecord,
} from "../../domain/spending.js";
import { submitForConfirmation } from "../../domain/confirmations.js";
import { registerMileageClaimExecutor } from "../../domain/mileageClaims.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const categorySchema = z.enum(["material", "fuel", "mileage", "receipt", "other"]);
const methodSchema = z.enum(["cash", "company_card", "personal_reimbursed"]);

export function registerSpendingTools(server: McpServer): void {
  registerMileageClaimExecutor();

  server.registerTool(
    "register_spend_record",
    {
      title: "Register Spend Record",
      description:
        "Directly records a spend -- a manager keying in a company-card purchase or petty-cash spend on someone's behalf. category='mileage' requires method='personal_reimbursed', distanceKm set, and amount omitted; every other category requires amount and forbids distanceKm. Minimum tier: 4.",
      inputSchema: z.object({
        ...credentialArg,
        category: categorySchema,
        method: methodSchema,
        amount: z.number().optional(),
        distanceKm: z.number().optional(),
        description: z.string().optional(),
        documentId: z.string().uuid().optional(),
        instrumentId: z.string().uuid().optional(),
        crewMemberId: z.string().uuid().optional(),
        submittedByUserId: z.string().uuid().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_spend_record", 4);
        const result = await registerSpendRecord(args);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.record) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "submit_mileage_claim",
    {
      title: "Submit Mileage Claim",
      description:
        "Submits a driver-self-reported distance for management review -- independent of trips.distance_meters, no amount computed at submission. Does not execute directly: creates a pending_confirmations row. The approver supplies ratePerKm at approval time (approve_pending_confirmation's approvalData) -- no system-wide rate exists. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid(), distanceKm: z.number().positive(), description: z.string().optional() }),
    },
    async ({ credentialJwt, crewMemberId, distanceKm, description }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:submit_mileage_claim", 2);
        const pending = await submitForConfirmation({
          actionType: "mileage_claim",
          capability: "mcp:tool:submit_mileage_claim",
          summary: `Mileage claim for ${distanceKm}km by crew member ${crewMemberId}`,
          payload: { crewMemberId, distanceKm, description: description ?? null },
          submittedByCrewMemberId: crewMemberId,
        });
        return { content: [{ type: "text", text: JSON.stringify({ status: "awaiting_review", pendingConfirmationId: pending.id }) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_spend_records",
    {
      title: "List Spend Records",
      description: "Lists spend records, optionally filtered by crew member, status, or category. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, crewMemberId: z.string().uuid().optional(), status: z.enum(["pending", "approved", "rejected", "disputed"]).optional(), category: categorySchema.optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_spend_records", 0);
        const records = await listSpendRecords(filter);
        return { content: [{ type: "text", text: JSON.stringify(records) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_missing_receipts",
    {
      title: "List Missing Receipts",
      description: "Lists approved, non-mileage spend records with no linked document. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_missing_receipts", 0);
        const records = await listMissingReceipts();
        return { content: [{ type: "text", text: JSON.stringify(records) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "approve_spend_record",
    {
      title: "Approve Spend Record",
      description: "Approves a pending (personal_reimbursed) spend record. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), reviewerCrewMemberId: z.string().uuid().optional(), reviewerUserId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, id, reviewerCrewMemberId, reviewerUserId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:approve_spend_record", 4);
        const result = await approveSpendRecord(id, { crewMemberId: reviewerCrewMemberId, userId: reviewerUserId });
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.record) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "reject_spend_record",
    {
      title: "Reject Spend Record",
      description: "Rejects a pending spend record. Minimum tier: 4.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), reviewerCrewMemberId: z.string().uuid().optional(), reviewerUserId: z.string().uuid().optional(), note: z.string().optional() }),
    },
    async ({ credentialJwt, id, reviewerCrewMemberId, reviewerUserId, note }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:reject_spend_record", 4);
        const result = await rejectSpendRecord(id, { crewMemberId: reviewerCrewMemberId, userId: reviewerUserId }, note);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.record) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "dispute_spend_record",
    {
      title: "Dispute Spend Record",
      description: "Crew-initiated dispute of a rejected spend record -- one round only. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), note: z.string() }),
    },
    async ({ credentialJwt, id, note }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:dispute_spend_record", 2);
        const result = await disputeSpendRecord(id, note);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.record) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
