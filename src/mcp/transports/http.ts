import "dotenv/config";
import { createServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { mcpServer } from "../server.js";

const port = Number(process.env.MCP_HTTP_PORT ?? 8090);

const handler = createMcpHandler(() => mcpServer, {
  onerror: (err) => console.error("[mcp-http]", err),
});
const nodeHandler = toNodeHandler(handler);

const server = createServer((req, res) => {
  nodeHandler(req, res).catch((err) => {
    console.error("[mcp-http] unhandled adapter error", err);
    if (!res.destroyed) res.end();
  });
});

server.listen(port, () => {
  console.log(`MCP Streamable HTTP server listening on :${port}`);
});
