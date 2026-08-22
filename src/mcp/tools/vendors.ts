import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getVendor, listVendors, registerVendor } from "../../domain/vendors.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerVendorTools(server: McpServer): void {
  server.registerTool(
    "register_vendor",
    {
      title: "Register Vendor",
      description: "Adds a new vendor as reference data. Minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        name: z.string(),
        contactMethod: z.string().optional(),
        contactAddress: z.string().optional(),
        accountNumber: z.string().optional(),
        leadTimeDays: z.number().int().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_vendor", 3);
        const vendor = await registerVendor(args);
        return { content: [{ type: "text", text: JSON.stringify(vendor) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_vendors",
    {
      title: "List Vendors",
      description: "Lists all vendors. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg }),
    },
    async ({ credentialJwt }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_vendors", 0);
        const vendors = await listVendors();
        return { content: [{ type: "text", text: JSON.stringify(vendors) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_vendor",
    {
      title: "Get Vendor",
      description: "Fetches a single vendor by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_vendor", 0);
        const vendor = await getVendor(id);
        if (!vendor) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(vendor) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
