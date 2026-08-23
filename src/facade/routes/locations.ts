// Task #156 follow-on: a map view was one of the things the pruning pass
// cut along with the vendored Geo Hub module, but this backend has real
// location data behind it (vehicle_telemetry, crew_telemetry) with
// nothing currently surfacing it. Unlike every other façade route, this
// one has no vendored frontend page to adapt at all -- the map page is
// new, purpose-built, so this route's shape is designed fresh rather
// than reverse-engineered from an existing contract.
//
// There is no live location feed yet (no WhatsApp location-share
// integration, no vehicle OBD/GPS -- both are Phase 3 scope), so
// /checkin exists to log a location by hand in the meantime: a
// dispatcher who knows where a crew member or vehicle actually is right
// now can record it, and it shows up on the map exactly like a real
// telemetry ping would, through the same domain functions
// (logCrewTelemetry/logVehicleTelemetry) and the same reverse-geocoding
// this façade already added for the Equipment page. When Phase 3 wires
// up a real feed, it lands in the same tables and this route needs no
// changes at all.
import type { Router } from "../router.js";
import { readJsonBody, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { getVehicle, listVehicles } from "../../domain/vehicles.js";
import { getCrewMember, listCrewWithLatestLocation } from "../../domain/crewMembers.js";
import { logCrewTelemetry, logVehicleTelemetry } from "../../domain/telemetry.js";

type LocationPoint = {
  id: string;
  type: "crew" | "vehicle";
  target_id: string;
  label: string;
  lat: number;
  lng: number;
  address: string | null;
  timestamp: string;
};

type CheckinBody = {
  type?: "crew" | "vehicle";
  target_id?: string;
  lat?: number;
  lng?: number;
};

export function registerLocationRoutes(router: Router): void {
  router.get("/api/v1/locations", async (req, res) => {
    try {
      await requireStaffRole(req);
      const [vehicles, crew] = await Promise.all([
        listVehicles(),
        listCrewWithLatestLocation({ active: true }),
      ]);

      const points: LocationPoint[] = [];
      for (const v of vehicles) {
        if (!v.latest_location) continue;
        points.push({
          id: v.latest_location.id,
          type: "vehicle",
          target_id: v.id,
          label: v.plate,
          lat: v.latest_location.lat,
          lng: v.latest_location.lng,
          address: v.latest_location.address,
          timestamp: v.latest_location.timestamp,
        });
      }
      for (const c of crew) {
        if (!c.latest_location) continue;
        points.push({
          id: c.latest_location.id,
          type: "crew",
          target_id: c.id,
          label: c.name,
          lat: c.latest_location.lat,
          lng: c.latest_location.lng,
          address: c.latest_location.address,
          timestamp: c.latest_location.timestamp,
        });
      }
      sendJson(res, 200, { items: points });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Manual check-in -- see file header. Real telemetry, not a fake
  // simulation: it writes to the same tables and goes through the same
  // reverse-geocoding a WhatsApp location share would.
  router.post("/api/v1/locations/checkin", async (req, res) => {
    try {
      await requireStaffRole(req);
      const body = await readJsonBody<CheckinBody>(req);
      if (body.type !== "crew" && body.type !== "vehicle") {
        sendJson(res, 422, { detail: "type must be 'crew' or 'vehicle'" });
        return;
      }
      if (!body.target_id || typeof body.lat !== "number" || typeof body.lng !== "number") {
        sendJson(res, 422, { detail: "target_id, lat, and lng are required" });
        return;
      }

      if (body.type === "vehicle") {
        const vehicle = await getVehicle(body.target_id);
        if (!vehicle) {
          sendJson(res, 404, { detail: "Not found" });
          return;
        }
        const point = await logVehicleTelemetry({ vehicleId: body.target_id, lat: body.lat, lng: body.lng });
        sendJson(res, 200, {
          id: point.id,
          type: "vehicle",
          target_id: point.vehicle_id,
          lat: point.lat,
          lng: point.lng,
          address: point.address,
          timestamp: point.timestamp,
        });
        return;
      }

      const crewMember = await getCrewMember(body.target_id);
      if (!crewMember) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      const point = await logCrewTelemetry({ crewMemberId: body.target_id, lat: body.lat, lng: body.lng });
      sendJson(res, 200, {
        id: point.id,
        type: "crew",
        target_id: point.crew_member_id,
        lat: point.lat,
        lng: point.lng,
        address: point.address,
        timestamp: point.timestamp,
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
