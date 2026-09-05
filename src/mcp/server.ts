import { McpServer } from "@modelcontextprotocol/server";
import { registerIdentityTools } from "./tools/identity.js";
import { registerSiteTools } from "./tools/sites.js";
import { registerGuardTools } from "./tools/guards.js";
import { registerShiftTools } from "./tools/shifts.js";
import { registerTimeclockTools } from "./tools/timeclock.js";
import { registerConfirmationTools } from "./tools/confirmations.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerCertificationTools } from "./tools/certifications.js";
import { registerIncidentTools } from "./tools/incidents.js";
import { registerPatrolTools } from "./tools/patrols.js";
import { registerPostTools } from "./tools/posts.js";
import { registerEquipmentTools } from "./tools/equipment.js";

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "ironhorse", version: "0.1.0" });
  registerIdentityTools(server);
  registerSiteTools(server);
  registerGuardTools(server);
  registerShiftTools(server);
  registerTimeclockTools(server); // also registers the timeclock_event confirmation executor
  registerConfirmationTools(server);
  registerMessageTools(server);
  registerCertificationTools(server);
  registerIncidentTools(server);
  registerPatrolTools(server);
  registerPostTools(server);
  registerEquipmentTools(server); // also registers the equipment_return confirmation executor
  return server;
}

// A single shared instance -- every tool here is stateless (capability
// checks are argument-based per call, not connection-scoped), so both
// transports serving the same instance is correct, not a shortcut. See
// src/mcp/middleware.ts.
export const mcpServer = buildMcpServer();
