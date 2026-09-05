import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  acknowledgeHandoffNote,
  getHandoffNote,
  leaveHandoffNote,
  listHandoffNotes,
} from "../../domain/handoffNotes.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerHandoffNoteTools(server: McpServer): void {
  server.registerTool(
    "leave_handoff_note",
    {
      title: "Leave Handoff Note",
      description:
        "A guard leaves a structured note for whoever's next on duty at the site -- requires the shift being handed off to be that guard's own. Minimum tier: 1.",
      inputSchema: z.object({
        ...credentialArg,
        siteId: z.string().uuid(),
        fromShiftId: z.string().uuid(),
        authorGuardId: z.string().uuid(),
        category: z.string(),
        body: z.string(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:leave_handoff_note", 1);
        const result = await leaveHandoffNote(args);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.note) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_handoff_notes",
    {
      title: "List Handoff Notes",
      description: "Lists handoff notes, optionally filtered by site and/or unacknowledged-only. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid().optional(), unacknowledgedOnly: z.boolean().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_handoff_notes", 0);
        const notes = await listHandoffNotes(filter);
        return { content: [{ type: "text", text: JSON.stringify(notes) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_handoff_note",
    {
      title: "Get Handoff Note",
      description: "Fetches a single handoff note by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_handoff_note", 0);
        const note = await getHandoffNote(id);
        if (!note) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(note) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "acknowledge_handoff_note",
    {
      title: "Acknowledge Handoff Note",
      description:
        "A guard acknowledges a handoff note -- requires an own shift at the note's site. Idempotent once acknowledged. Minimum tier: 1.",
      inputSchema: z.object({ ...credentialArg, noteId: z.string().uuid(), shiftId: z.string().uuid(), guardId: z.string().uuid() }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:acknowledge_handoff_note", 1);
        const result = await acknowledgeHandoffNote(args);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.note) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
