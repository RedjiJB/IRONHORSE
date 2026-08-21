// The Phase 1 "does the skeleton actually work" tools: whoami proves a
// capability-gated call succeeds/fails correctly; list_capabilities proves
// the DB-backed grant index is queryable through the same gate. Every
// domain-specific tool built in Phase 2 follows this exact registration
// shape (declare a capability id + minimum tier, wrap the handler in
// requireCapability).
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { pool } from "../../db/pool.js";
import { CapabilityDeniedError, requireCapability } from "../middleware.js";

const credentialArg = { credentialJwt: z.string().describe("The caller's presented CapabilityGrant VC (JWT)") };

export function registerIdentityTools(server: McpServer): void {
  server.registerTool(
    "whoami",
    {
      title: "Who Am I",
      description: "Verifies the caller's presented capability credential and returns their DID and tier. Minimum tier: 0 (read-only).",
      inputSchema: z.object(credentialArg),
    },
    async ({ credentialJwt }) => {
      try {
        const { subjectDid, tier } = await requireCapability(credentialJwt, "mcp:tool:whoami", 0);
        return {
          content: [{ type: "text", text: JSON.stringify({ did: subjectDid, tier }) }],
        };
      } catch (err) {
        if (err instanceof CapabilityDeniedError) {
          return { content: [{ type: "text", text: `Denied: ${err.reason}` }], isError: true };
        }
        throw err;
      }
    },
  );

  server.registerTool(
    "list_capabilities",
    {
      title: "List My Capabilities",
      description: "Lists every active (unexpired, unrevoked) capability grant held by the caller's own DID. Minimum tier: 0 (read-only).",
      inputSchema: z.object(credentialArg),
    },
    async ({ credentialJwt }) => {
      try {
        const { subjectDid } = await requireCapability(credentialJwt, "mcp:tool:list_capabilities", 0);
        const result = await pool.query(
          `SELECT capability, tier, expires_at, created_at
           FROM capability_grants
           WHERE subject_did = $1 AND revoked_at IS NULL
           ORDER BY created_at DESC`,
          [subjectDid],
        );
        return { content: [{ type: "text", text: JSON.stringify(result.rows) }] };
      } catch (err) {
        if (err instanceof CapabilityDeniedError) {
          return { content: [{ type: "text", text: `Denied: ${err.reason}` }], isError: true };
        }
        throw err;
      }
    },
  );
}
