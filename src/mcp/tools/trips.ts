import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { endTrip, listTrips, startTrip } from "../../domain/trips.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerTripTools(server: McpServer): void {
  server.registerTool(
    "start_trip",
    {
      title: "Start Trip",
      description:
        "Opens a trip for a vehicle+driver pair. A vehicle can only have one open trip at a time -- enforced at the DB level, not just an application check. Minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        vehicleId: z.string().uuid(),
        driverId: z.string().uuid(),
        purposeTag: z.string().optional(),
        siteId: z.string().uuid().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:start_trip", 3);
        const result = await startTrip(args);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.trip) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "end_trip",
    {
      title: "End Trip",
      description:
        "Closes an open trip, computing duration_seconds and a haversine-summed distance_meters from telemetry recorded during the trip window (NULL if fewer than 2 points -- a lower-bound estimate, not GPS-accurate tracking). Minimum tier: 3.",
      inputSchema: z.object({ ...credentialArg, tripId: z.string().uuid() }),
    },
    async ({ credentialJwt, tripId }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:end_trip", 3);
        const result = await endTrip(tripId);
        if (!result.ok) return { content: [{ type: "text", text: `Denied: ${result.reason}` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(result.trip) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_trips",
    {
      title: "List Trips",
      description: "Lists trips, optionally filtered by vehicle or driver. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, vehicleId: z.string().uuid().optional(), driverId: z.string().uuid().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_trips", 0);
        const trips = await listTrips(filter);
        return { content: [{ type: "text", text: JSON.stringify(trips) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
