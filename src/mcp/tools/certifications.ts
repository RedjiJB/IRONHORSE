import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  addCertification,
  listCertificationsForGuard,
  listExpiredCertifications,
  listExpiringSoonCertifications,
} from "../../domain/certifications.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerCertificationTools(server: McpServer): void {
  server.registerTool(
    "add_certification",
    {
      title: "Add Certification",
      description: "Records a certification a guard holds, with its expiry date. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        guardId: z.string().uuid(),
        certType: z.string(),
        issuedAt: z.string().optional(),
        expiresAt: z.string(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:add_certification", 2);
        const cert = await addCertification(args);
        return { content: [{ type: "text", text: JSON.stringify(cert) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_guard_certifications",
    {
      title: "List Guard Certifications",
      description: "Lists a guard's certifications. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, guardId: z.string().uuid() }),
    },
    async ({ credentialJwt, guardId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_guard_certifications", 0);
        const certs = await listCertificationsForGuard(guardId);
        return { content: [{ type: "text", text: JSON.stringify(certs) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_expiring_certifications",
    {
      title: "List Expiring Certifications",
      description: "Lists certifications expiring within the given number of days (not yet expired). Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, daysAhead: z.number().int().positive().default(30) }),
    },
    async ({ credentialJwt, daysAhead }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_expiring_certifications", 0);
        const certs = await listExpiringSoonCertifications(daysAhead);
        return { content: [{ type: "text", text: JSON.stringify(certs) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_expired_certifications",
    {
      title: "List Expired Certifications",
      description: "Lists certifications that have already expired. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_expired_certifications", 0);
        const certs = await listExpiredCertifications();
        return { content: [{ type: "text", text: JSON.stringify(certs) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
