import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getSiteVisit, listSiteVisits, logSiteVisit } from "../../domain/siteVisits.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerSiteVisitTools(server: McpServer): void {
  server.registerTool(
    "log_site_visit",
    {
      title: "Log Site Visit",
      description:
        "A supervisor logs their own spot-check visit to a site. geofenceVerified is resolved server-side from resolveGeofenceVerified, never client-asserted. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        supervisorGuardId: z.string().uuid(),
        siteId: z.string().uuid(),
        lat: z.number().optional(),
        lng: z.number().optional(),
        note: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:log_site_visit", 2);
        const visit = await logSiteVisit(args);
        return { content: [{ type: "text", text: JSON.stringify(visit) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_site_visits",
    {
      title: "List Site Visits",
      description: "Lists site visits, optionally filtered by site and/or supervisor. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, siteId: z.string().uuid().optional(), supervisorGuardId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_site_visits", 0);
        const visits = await listSiteVisits(filter);
        return { content: [{ type: "text", text: JSON.stringify(visits) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_site_visit",
    {
      title: "Get Site Visit",
      description: "Fetches a single site visit by id. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_site_visit", 0);
        const visit = await getSiteVisit(id);
        if (!visit) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(visit) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
