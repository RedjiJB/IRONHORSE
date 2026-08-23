// Task #156 slice D. Maps this backend's vehicles.ts (a 4-column table:
// plate, assigned_crew_id, current_mileage, latest telemetry) onto the
// vendored frontend's much richer Equipment type (manufacturer/model/
// serial/year, financial fields, a real status/ownership/type taxonomy)
// -- confirmed exact field names by reading the frontend's own
// src/features/equipment/api.ts, not guessed.
//
// Fields with no backing data are fixed stubs: ownership='owned',
// status='active' always, currency='USD', depreciation_method=
// 'straight_line'. Since every vehicle reports the same stub status/
// ownership/type, filtering by those query params is emulated in
// memory (anything other than the stub value returns empty) rather than
// pushed into SQL against columns that don't exist.
//
// Deliberately NOT built here (see docs/ARCHITECTURE.md Task #156 scope
// table): maintenance work orders, inspections, damage reports, and the
// health-analytics/failure-forecast/fleet-optimization analytics
// endpoints -- no domain backing exists for any of these, and building
// fake analytics would be worse than an isolated 404 on that one tab.
// DELETE is also omitted -- hard-deleting a vehicle with existing
// trips/telemetry rows has real FK-cascade risk and no clear domain
// semantic (unlike assets, vehicles have no "retired" status to move to
// instead).
import type { Router } from "../router.js";
import { getQueryInt, getQueryParam, readJsonBody, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { getVehicle, listVehicles, registerVehicle, updateVehicle, type VehicleWithLatestLocation } from "../../domain/vehicles.js";
import { listVehicleTelemetry, ensureVehicleTelemetryAddress } from "../../domain/telemetry.js";

const STUB_TYPE_CODE = "vehicle";
const STUB_OWNERSHIP = "owned";
const STUB_STATUS = "active";

// The vendored frontend's Equipment type has no address field at all --
// it only ever showed raw coordinates. Rather than add a field to that
// shared type for one module, the reverse-geocoded address rides in
// `metadata.address`, which EquipmentPage.tsx reads directly (see the
// façade slice's own file header convention: fields with no backing
// type go in metadata, not invented onto the contract).
async function toFrontendShape(v: VehicleWithLatestLocation) {
  let address = v.latest_location?.address ?? null;
  if (!address && v.latest_location) {
    address = await ensureVehicleTelemetryAddress(v.latest_location.id, v.latest_location.lat, v.latest_location.lng);
  }
  return {
    id: v.id,
    code: v.plate,
    name: v.plate,
    type_code: STUB_TYPE_CODE,
    manufacturer: null,
    model: null,
    serial: null,
    year: null,
    ownership: STUB_OWNERSHIP,
    status: STUB_STATUS,
    location_lat: v.latest_location?.lat ?? null,
    location_lng: v.latest_location?.lng ?? null,
    hour_meter: 0,
    odometer_km: v.current_mileage ?? 0,
    last_telemetry_at: v.latest_location?.timestamp ?? null,
    purchase_date: null,
    purchase_value: null,
    depreciation_method: "straight_line",
    useful_life_years: null,
    residual_value: null,
    currency: "USD",
    notes: null,
    metadata: address ? { address } : {},
    created_at: v.created_at,
    updated_at: v.created_at,
  };
}

type CreateEquipmentBody = { code?: string; odometer_km?: number };
type UpdateEquipmentBody = { code?: string; odometer_km?: number };

export function registerEquipmentRoutes(router: Router): void {
  router.get("/api/v1/equipment/equipment", async (req, res) => {
    try {
      await requireStaffRole(req);
      const limit = getQueryInt(req, "limit", 50);
      const offset = getQueryInt(req, "offset", 0);
      const status = getQueryParam(req, "status");
      const type = getQueryParam(req, "type");
      const ownership = getQueryParam(req, "ownership");

      // Every vehicle reports the same stub status/type/ownership --
      // anything other than that stub value is emulated as "no matches",
      // not pushed into a SQL WHERE clause against columns that don't exist.
      if ((status && status !== STUB_STATUS) || (type && type !== STUB_TYPE_CODE) || (ownership && ownership !== STUB_OWNERSHIP)) {
        sendJson(res, 200, { items: [], total: 0, offset, limit });
        return;
      }

      const all = await listVehicles();
      const total = all.length;
      const page = all.slice(offset, offset + limit);
      sendJson(res, 200, { items: await Promise.all(page.map(toFrontendShape)), total, offset, limit });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/equipment/equipment/:id", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const vehicle = await getVehicle(id);
      if (!vehicle) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      sendJson(res, 200, await toFrontendShape(vehicle));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/equipment/equipment", async (req, res) => {
    try {
      await requireStaffRole(req);
      const body = await readJsonBody<CreateEquipmentBody>(req);
      if (!body.code) {
        sendJson(res, 422, { detail: "code is required" });
        return;
      }
      const vehicle = await registerVehicle({ plate: body.code, currentMileage: body.odometer_km });
      const withLocation = await getVehicle(vehicle.id);
      sendJson(res, 200, await toFrontendShape(withLocation!));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.patch("/api/v1/equipment/equipment/:id", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const body = await readJsonBody<UpdateEquipmentBody>(req);
      const updated = await updateVehicle(id, { plate: body.code, currentMileage: body.odometer_km });
      if (!updated) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      const withLocation = await getVehicle(id);
      sendJson(res, 200, await toFrontendShape(withLocation!));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/equipment/equipment/:id/telemetry", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const points = await listVehicleTelemetry(id);
      sendJson(res, 200, points.map((p) => ({
        id: p.id,
        equipment_id: p.vehicle_id,
        recorded_at: p.timestamp,
        fuel_level: null,
        hour_meter: null,
        odometer_km: null,
        lat: p.lat,
        lng: p.lng,
        engine_status: null,
        raw_payload: {},
      })));
    } catch (err) {
      sendError(res, err);
    }
  });

  // The whole equipment-type taxonomy this backend actually has: one.
  // No real per-type service-interval/inspection-interval concept exists
  // (assets.ts's service_interval_days is per-asset, not per-type).
  router.get("/api/v1/equipment/types", async (req, res) => {
    try {
      await requireStaffRole(req);
      sendJson(res, 200, {
        items: [{ id: STUB_TYPE_CODE, code: STUB_TYPE_CODE, name: "Vehicle", category: "fleet" }],
        total: 1,
        offset: 0,
        limit: 1,
      });
    } catch (err) {
      sendError(res, err);
    }
  });
}
