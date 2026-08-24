// Dashboard restoration, Slice I: the vendored dashboard's "project
// locations & weather" map needs a list of real places to plot. Sites
// (src/domain/sites.ts) already store a real address and lat/lng per
// site -- unlike the vendored ERP's "projects", which have no native
// location and had to be geocoded client-side via Nominatim. Read-only:
// site registration stays an ops/MCP-tool operation (registerSite),
// matching how user provisioning stays MCP-only in the auth façade.
//
// Slice M added crew_today_count/open_alerts_count for the site-cards
// widget (the vendored dashboard's "projects" section) -- extending this
// same endpoint rather than a new one, since both widgets want the same
// site list, just with different fields rendered.
import type { Router } from "../router.js";
import { sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { listSitesWithActivityCounts } from "../../domain/sites.js";

export function registerSiteRoutes(router: Router): void {
  router.get("/api/v1/sites", async (req, res) => {
    try {
      await requireStaffRole(req);
      const sites = await listSitesWithActivityCounts();
      sendJson(res, 200, {
        items: sites.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          address: s.address,
          lat: s.center_lat,
          lng: s.center_lng,
          crew_today_count: s.crew_today_count,
          open_alerts_count: s.open_alerts_count,
        })),
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
