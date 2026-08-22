import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { classifyDocument, listDocuments, listExpiringDocuments, registerDocument, uploadDocument } from "../../domain/documents.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerDocumentTools(server: McpServer): void {
  server.registerTool(
    "register_document",
    {
      title: "Register Document",
      description: "Adds a metadata-only document row -- no file, just a record. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        type: z.string(),
        filename: z.string(),
        jobId: z.string().uuid().optional(),
        siteId: z.string().uuid().optional(),
        uploadedBy: z.string().uuid().optional(),
        tags: z.array(z.string()).optional(),
        expiryDate: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_document", 2);
        const document = await registerDocument(args);
        return { content: [{ type: "text", text: JSON.stringify(document) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "upload_document",
    {
      title: "Upload Document",
      description:
        "Uploads a real file (base64-encoded), validated against a MIME-type allowlist and stored under a randomly generated filename -- never derived from the caller-supplied filename, to prevent path traversal. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        type: z.string(),
        filename: z.string(),
        mimeType: z.string(),
        contentBase64: z.string(),
        jobId: z.string().uuid().optional(),
        siteId: z.string().uuid().optional(),
        uploadedBy: z.string().uuid().optional(),
        tags: z.array(z.string()).optional(),
        expiryDate: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:upload_document", 2);
        const result = await uploadDocument(args);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.document) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "classify_document",
    {
      title: "Classify Document",
      description: "Corrects a document's type after the fact -- e.g. a photo auto-filed as 'photo' upgraded to 'receipt' once identified. Minimum tier: 2.",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid(), type: z.string() }),
    },
    async ({ credentialJwt, id, type }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:classify_document", 2);
        const document = await classifyDocument(id, type);
        if (!document) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(document) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_documents",
    {
      title: "List Documents",
      description: "Lists documents, optionally filtered by site or type. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid().optional(), type: z.string().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_documents", 0);
        const documents = await listDocuments(filter);
        return { content: [{ type: "text", text: JSON.stringify(documents) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_expiring_documents",
    {
      title: "List Expiring Documents",
      description: "Lists documents expiring within N days -- includes already-past-expiry rows, not just upcoming ones. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, withinDays: z.number().int() }),
    },
    async ({ credentialJwt, withinDays }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_expiring_documents", 0);
        const documents = await listExpiringDocuments(withinDays);
        return { content: [{ type: "text", text: JSON.stringify(documents) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
