import "dotenv/config";
import { createServer } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { mcpServer } from "../server.js";
import { buildDidDocument, didWebForAgent, didWebForDomain } from "../../identity/did.js";
import { loadPublicJwk } from "../../identity/keys.js";
import { startExceptionsWorker } from "../../domain/exceptions.js";
import { withRequestContext } from "../requestContext.js";

// Static per-server credential header, for MCP clients (e.g. OpenClaw's
// native `mcp add --header`) that can attach one fixed value to every
// request but can't inject a per-tool-call argument -- see
// src/mcp/middleware.ts's fallback in requireCapability().
const CREDENTIAL_HEADER = "x-capability-grant";

const port = Number(process.env.MCP_HTTP_PORT ?? 8090);
const domain = process.env.NODE_DID_DOMAIN;
const alertsCheckIntervalMs = Number(process.env.ALERTS_CHECK_INTERVAL_MS ?? 5 * 60 * 1000);

const handler = createMcpHandler(() => mcpServer, {
  onerror: (err) => console.error("[mcp-http]", err),
});
const nodeHandler = toNodeHandler(handler);

// Serves this node's own did:web document at the spec-mandated
// .well-known path, and any agent's path-based sub-DID document at
// /agents/<role>/did.json -- the actual HTTPS resolution endpoints did.ts's
// resolveDid() fetches for a DID this instance doesn't hold the key for
// locally (i.e. any future remote caller, not this node's own lookups).
async function serveDidDocument(did: string, res: import("node:http").ServerResponse): Promise<boolean> {
  const publicJwk = await loadPublicJwk(did);
  if (!publicJwk) return false;
  res.writeHead(200, { "content-type": "application/did+json" });
  res.end(JSON.stringify(buildDidDocument(did, publicJwk)));
  return true;
}

const server = createServer((req, res) => {
  const url = req.url ?? "";

  if (domain && req.method === "GET" && url === "/.well-known/did.json") {
    serveDidDocument(didWebForDomain(domain), res).then((found) => {
      if (!found) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
    });
    return;
  }

  const agentMatch = domain ? url.match(/^\/agents\/([^/]+)\/did\.json$/) : null;
  if (agentMatch) {
    serveDidDocument(didWebForAgent(domain!, decodeURIComponent(agentMatch[1])), res).then((found) => {
      if (!found) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
      }
    });
    return;
  }

  const headerValue = req.headers[CREDENTIAL_HEADER];
  const headerCredentialJwt = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  withRequestContext({ headerCredentialJwt }, () => {
    nodeHandler(req, res).catch((err) => {
      console.error("[mcp-http] unhandled adapter error", err);
      if (!res.destroyed) res.end();
    });
  });
});

server.listen(port, () => {
  console.log(`MCP Streamable HTTP server listening on :${port}`);
});

startExceptionsWorker(alertsCheckIntervalMs);
