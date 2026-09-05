import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { broadcastToSite, listInbox, markMessageRead, sendMessage } from "../../domain/messages.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerMessageTools(server: McpServer): void {
  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description: "Sends a direct message from a supervisor to a guard. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        senderId: z.string().uuid(),
        recipientId: z.string().uuid(),
        body: z.string(),
      }),
    },
    async ({ credentialJwt, senderId, recipientId, body }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:send_message", 2);
        const message = await sendMessage({ senderId, recipientId, body });
        return { content: [{ type: "text", text: JSON.stringify(message) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "broadcast_to_site",
    {
      title: "Broadcast To Site",
      description: "Broadcasts a message to every guard currently on duty at a site. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        senderId: z.string().uuid(),
        siteId: z.string().uuid(),
        body: z.string(),
      }),
    },
    async ({ credentialJwt, senderId, siteId, body }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:broadcast_to_site", 2);
        const messages = await broadcastToSite({ senderId, siteId, body });
        return { content: [{ type: "text", text: JSON.stringify(messages) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_inbox",
    {
      title: "List Inbox",
      description: "Lists a guard's received messages, optionally unread-only. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, guardId: z.string().uuid(), unreadOnly: z.boolean().optional() }),
    },
    async ({ credentialJwt, guardId, unreadOnly }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_inbox", 0);
        const messages = await listInbox(guardId, { unreadOnly });
        return { content: [{ type: "text", text: JSON.stringify(messages) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "mark_message_read",
    {
      title: "Mark Message Read",
      description: "Marks a message the caller received as read. Minimum tier: 1.",
      inputSchema: z.object({ ...credentialArg, messageId: z.string().uuid(), guardId: z.string().uuid() }),
    },
    async ({ credentialJwt, messageId, guardId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:mark_message_read", 1);
        const result = await markMessageRead(messageId, guardId);
        if (!result.ok) return { content: [{ type: "text", text: `Failed: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.message) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
