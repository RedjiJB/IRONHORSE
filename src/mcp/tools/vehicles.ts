import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { getVehicle, listVehicles, registerVehicle } from "../../domain/vehicles.js";
import { requireCapability } from "../middleware.js";
import { credentialArg, deniedResult } from "./shared.js";

export function registerVehicleTools(server: McpServer): void {
  server.registerTool(
    "register_vehicle",
    {
      title: "Register Vehicle",
      description: "Adds a new vehicle to the fleet. Only plate is required. Minimum tier: 3.",
      inputSchema: z.object({
        ...credentialArg,
        plate: z.string(),
        assignedCrewId: z.string().uuid().optional(),
        currentMileage: z.number().optional(),
      }),
    },
    async ({ credentialJwt, ...args }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:register_vehicle", 3);
        const vehicle = await registerVehicle(args);
        return { content: [{ type: "text", text: JSON.stringify(vehicle) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "list_vehicles",
    {
      title: "List Vehicles",
      description: "Lists vehicles with each one's latest known location, optionally filtered by assigned driver or plate. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, assignedCrewId: z.string().uuid().optional(), plate: z.string().optional() }),
    },
    async ({ credentialJwt, ...filter }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:list_vehicles", 0);
        const vehicles = await listVehicles(filter);
        return { content: [{ type: "text", text: JSON.stringify(vehicles) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );

  server.registerTool(
    "get_vehicle",
    {
      title: "Get Vehicle",
      description: "Fetches a single vehicle by id, including its latest known location. Minimum tier: 0 (read-only).",
      inputSchema: z.object({ ...credentialArg, id: z.string().uuid() }),
    },
    async ({ credentialJwt, id }) => {
      try {
        await requireCapability(credentialJwt, "mcp:tool:get_vehicle", 0);
        const vehicle = await getVehicle(id);
        if (!vehicle) return { content: [{ type: "text", text: "Not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(vehicle) }] };
      } catch (err) {
        return deniedResult(err);
      }
    },
  );
}
