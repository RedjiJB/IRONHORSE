import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getSite, listSites, registerSite } from "../../domain/sites.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const siteTypeSchema = z.enum(["job_site", "depot", "vendor", "shop"]);

export function registerSiteTools(server: McpServer): void {
  server.registerTool(
    "register_site",
    {
      title: "Register Site",
      description: "Registers a new job site, depot, vendor location, or shop. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        name: z.string(),
        type: siteTypeSchema,
        address: z.string().optional(),
        centerLat: z.number().optional(),
        centerLng: z.number().optional(),
        geofenceRadiusM: z.number().int().positive().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_site", 2);
        const site = await registerSite(args);
        return { content: [{ type: "text", text: JSON.stringify(site) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_sites",
    {
      title: "List Sites",
      description: "Lists sites, optionally filtered by type. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, type: siteTypeSchema.optional() }),
    },
    async ({ credentialJwt, type }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_sites", 0);
        const sites = await listSites(type ? { type } : undefined);
        return { content: [{ type: "text", text: JSON.stringify(sites) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_site",
    {
      title: "Get Site",
      description: "Fetches a single site by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_site", 0);
        const site = await getSite(id);
        if (!site) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(site) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
