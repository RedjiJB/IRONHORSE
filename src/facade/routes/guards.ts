// Basis for the supervisor live-roster view (FEATURES.md §3: "on duty,
// post, clocked-in status, last location"). Post/last-location aren't
// modeled yet (post is Phase 2, tied to certification gating; location
// would need crew-telemetry, not built for guards yet) -- this route
// exposes what's real today: name, role, active flag, and which site (if
// any) the guard is currently clocked in at.
import type { Router } from "../router.js";
import { sendError, sendJson } from "../context.js";
import { requireSupervisor } from "../auth.js";
import { listGuardsWithOnDutyStatus } from "../../domain/guards.js";

export function registerGuardRoutes(router: Router): void {
  router.get("/guards/on-duty", async (req, res) => {
    try {
      await requireSupervisor(req);
      const guards = await listGuardsWithOnDutyStatus({ active: true });
      sendJson(res, 200, { guards });
    } catch (err) {
      sendError(res, err);
    }
  });
}
