// The REST façade -- a separate process/entry point from the MCP HTTP
// transport (src/mcp/transports/http.ts), which stays untouched. Façade
// route handlers call src/domain/*.ts functions directly, never through
// the MCP tool layer -- this sidesteps "how does a browser session
// become a capability-bearing MCP caller" entirely, since the façade
// enforces real authorization itself (src/facade/auth.ts) and has no
// need to round-trip through MCP for its own process's domain calls.
//
// No domain routes exist yet -- IRONHORSE's own domain modules
// (patrols, checkpoints, incidents, cameras) land in Phase 1/2 per
// docs/ROADMAP.md, each registering its own routes/*.ts here then.
import "dotenv/config";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { Router } from "./router.js";
import { sendJson } from "./context.js";

export function buildFacadeServer(): Server {
  const router = new Router();

  return createServer((req, res) => {
    router.dispatch(req, res).then((handled) => {
      if (!handled) sendJson(res, 404, { detail: "Not found" });
    }).catch((err) => {
      console.error("[facade] unhandled dispatch error", err);
      if (!res.headersSent) sendJson(res, 500, { detail: "Internal server error" });
    });
  });
}

// Only actually listen when this module is run directly (npm run
// facade:http) -- importing buildFacadeServer for tests must not have
// the side effect of binding a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FACADE_HTTP_PORT ?? 8199);
  buildFacadeServer().listen(port, () => {
    console.log(`REST façade listening on :${port}`);
  });
}
