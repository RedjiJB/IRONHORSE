import { McpServer } from "@modelcontextprotocol/server";
import { registerIdentityTools } from "./tools/identity.js";

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "ironhorse", version: "0.1.0" });
  registerIdentityTools(server);
  return server;
}

// A single shared instance -- every tool here is stateless (capability
// checks are argument-based per call, not connection-scoped), so both
// transports serving the same instance is correct, not a shortcut. See
// src/mcp/middleware.ts.
export const mcpServer = buildMcpServer();
