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
//
// Map follow-on: registering a site was deliberately kept ops/MCP-only
// above -- extended here on direct request, so the map's "log a
// location" form can also register a site (not just ping a crew/vehicle
// location), admin-gated rather than the checkin route's staff bar since
// creating a site is a structural change, not an ephemeral ping. Accepts
// either a lat/lng pair directly or an address to forward-geocode --
// same Nominatim decision the checkin route below now also uses.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireAdminRole, requireStaffRole } from "../auth.js";
import { listSitesWithActivityCounts, registerSite, type SiteType } from "../../domain/sites.js";
import { geocodeAddressViaNominatim } from "../../domain/telemetry.js";

const SITE_TYPES: SiteType[] = ["job_site", "depot", "vendor", "shop"];

type CreateSiteBody = {
  name?: string;
  type?: string;
  address?: string;
  lat?: number;
  lng?: number;
  geofence_radius_m?: number;
};

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

  router.post("/api/v1/sites", async (req, res) => {
    try {
      await requireAdminRole(req);
      const body = await readJsonBody<CreateSiteBody>(req);
      if (!body.name?.trim()) {
        sendJson(res, 422, { detail: "name is required" });
        return;
      }
      const type = body.type && SITE_TYPES.includes(body.type as SiteType) ? (body.type as SiteType) : undefined;
      if (!type) {
        sendJson(res, 422, { detail: `type must be one of: ${SITE_TYPES.join(", ")}` });
        return;
      }

      let lat = body.lat;
      let lng = body.lng;
      if ((typeof lat !== "number" || typeof lng !== "number")) {
        if (!body.address?.trim()) {
          sendJson(res, 422, { detail: "Provide either lat/lng or an address" });
          return;
        }
        const geocoded = await geocodeAddressViaNominatim(body.address);
        if (!geocoded) {
          sendJson(res, 422, { detail: "Could not resolve that address" });
          return;
        }
        lat = geocoded.lat;
        lng = geocoded.lng;
      }

      const site = await registerSite({
        name: body.name.trim(),
        type,
        address: body.address?.trim(),
        centerLat: lat,
        centerLng: lng,
        geofenceRadiusM: body.geofence_radius_m,
      });
      sendJson(res, 200, {
        id: site.id,
        name: site.name,
        type: site.type,
        address: site.address,
        lat: site.center_lat,
        lng: site.center_lng,
        crew_today_count: 0,
        open_alerts_count: 0,
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
