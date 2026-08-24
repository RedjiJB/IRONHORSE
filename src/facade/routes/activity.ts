// Dashboard restoration, Slice K: the vendored dashboard's "recent
// activity" feed (shared/ui/ActivityFeed.tsx) is a generic timeline
// component -- it just needed a real, cross-module event source. See
// src/domain/activity.ts for what's actually synthesized and why.
import type { Router } from "../router.js";
import { getQueryInt, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { listRecentActivity } from "../../domain/activity.js";

export function registerActivityRoutes(router: Router): void {
  router.get("/api/v1/activity", async (req, res) => {
    try {
      await requireStaffRole(req);
      const limit = getQueryInt(req, "limit", 30);
      const items = await listRecentActivity(limit);
      sendJson(res, 200, { items });
    } catch (err) {
      sendError(res, err);
    }
  });
}
