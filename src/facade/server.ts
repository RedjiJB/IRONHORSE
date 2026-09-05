// The REST façade -- a separate process/entry point from the MCP HTTP
// transport (src/mcp/transports/http.ts), which stays untouched. Façade
// route handlers call src/domain/*.ts functions directly, never through
// the MCP tool layer -- this sidesteps "how does a browser session
// become a capability-bearing MCP caller" entirely, since the façade
// enforces real authorization itself (src/facade/auth.ts) and has no
// need to round-trip through MCP for its own process's domain calls.
//
// Phase 1 routes: dev login, supervisor live-roster, approve/reject queue.
// IRONHORSE's later domain modules (patrols, checkpoints, incidents,
// cameras) land in Phase 2 per docs/ROADMAP.md, each registering its own
// routes/*.ts here then.
import "dotenv/config";
import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { Router } from "./router.js";
import { sendJson } from "./context.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerGuardRoutes } from "./routes/guards.js";
import { registerConfirmationRoutes } from "./routes/confirmations.js";
import { registerMessageRoutes } from "./routes/messages.js";
import { registerCertificationRoutes } from "./routes/certifications.js";
import { registerIncidentRoutes } from "./routes/incidents.js";
import { registerPatrolRoutes } from "./routes/patrols.js";
import { registerPostRoutes } from "./routes/posts.js";
import { registerShiftRoutes } from "./routes/shifts.js";
import { registerEquipmentRoutes } from "./routes/equipment.js";
import { registerUiRoutes } from "./routes/ui.js";
import { registerTimeclockConfirmationExecutor } from "../domain/timeclock.js";
import { registerEquipmentReturnExecutor } from "../domain/equipment.js";

export function buildFacadeServer(): Server {
  // The confirmation-executor registry (src/domain/confirmations.ts) is
  // in-memory per process -- the MCP server registers this same executor
  // independently (src/mcp/tools/timeclock.ts) because it's a separate
  // process with its own empty registry, not shared state. Every
  // confirmable action's executor needs registering here too, or approval
  // through the façade fails with no_executor_registered even though the
  // pending_confirmations row and the DB are perfectly fine.
  registerTimeclockConfirmationExecutor();
  registerEquipmentReturnExecutor();

  const router = new Router();
  registerAuthRoutes(router);
  registerGuardRoutes(router);
  registerConfirmationRoutes(router);
  registerMessageRoutes(router);
  registerCertificationRoutes(router);
  registerIncidentRoutes(router);
  registerPatrolRoutes(router);
  registerPostRoutes(router);
  registerShiftRoutes(router);
  registerEquipmentRoutes(router);
  registerUiRoutes(router);

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
