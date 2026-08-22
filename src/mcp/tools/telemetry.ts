import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { listVehicleTelemetry, logLocationShare, logVehicleTelemetry } from "../../domain/telemetry.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

const sourceSchema = z.enum(["whatsapp_location", "obd"]);

export function registerTelemetryTools(server: McpServer): void {
  server.registerTool(
    "log_vehicle_location",
    {
      title: "Log Vehicle Location",
      description:
        "Logs a location ping for a vehicle -- passive telemetry the crew member already chose to send, not a decision made on their behalf, so unlike timeclock events this does not go through confirm-before-execute. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        vehicleId: z.string().uuid(),
        lat: z.number(),
        lng: z.number(),
        source: sourceSchema.optional(),
        address: z.string().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:log_vehicle_location", 2);
        const point = await logVehicleTelemetry(args);
        return { content: [{ type: "text", text: JSON.stringify(point) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "log_location_share",
    {
      title: "Log Location Share",
      description:
        "Logs a crew member's WhatsApp location share -- always written to their own crew_telemetry stream, and additionally to vehicle_telemetry if exactly one vehicle resolves to them as its assigned driver. Same passive-telemetry reasoning as log_vehicle_location -- no confirm-before-execute. Minimum tier: 2.",
      inputSchema: z.object({
        ...credentialArg,
        crewMemberId: z.string().uuid(),
        lat: z.number(),
        lng: z.number(),
        source: sourceSchema.optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:log_location_share", 2);
        const result = await logLocationShare(args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_vehicle_telemetry",
    {
      title: "List Vehicle Telemetry",
      description: "Lists a vehicle's location history, optionally bounded by a time window. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, vehicleId: z.string().uuid(), since: z.string().optional(), until: z.string().optional() }),
    },
    async ({ credentialJwt, vehicleId, since, until }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_vehicle_telemetry", 0);
        const points = await listVehicleTelemetry(vehicleId, { since, until });
        return { content: [{ type: "text", text: JSON.stringify(points) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
