// Re-expressed from v1's vehicle_telemetry/crew_telemetry domain logic --
// requirements baseline, not copied code. A location ping, nothing
// richer -- no ignition state, speed, fuel, or diagnostics exist here
// either. The actual reverse-geocoding HTTP call (Nominatim, per
// policy/sovereignty_tiers.yaml's existing external_accepted decision) is
// Phase 3 (WhatsApp/OpenClaw wiring) scope -- callers may pass an
// already-resolved address, or the caller's future geocoding step can
// call this after; what *is* built here is the reuse-if-nearby decision
// itself, since it needs no network call and is real domain logic.
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "./geo.js";

export type TelemetrySource = "whatsapp_location" | "obd";

// Matches v1's GEOCODE_REUSE_RADIUS_METERS -- a new point within 100m of
// the last resolved one reuses that address rather than needing a fresh
// (rate-limited) reverse-geocode.
const GEOCODE_REUSE_RADIUS_METERS = 100;

export type VehicleTelemetryPoint = {
  id: string;
  vehicle_id: string;
  timestamp: string;
  lat: number;
  lng: number;
  source: TelemetrySource;
  address: string | null;
};

export type CrewTelemetryPoint = {
  id: string;
  crew_member_id: string;
  timestamp: string;
  lat: number;
  lng: number;
  source: TelemetrySource;
  address: string | null;
};

export async function logVehicleTelemetry(args: {
  vehicleId: string;
  lat: number;
  lng: number;
  source?: TelemetrySource;
  address?: string;
}): Promise<VehicleTelemetryPoint> {
  const address = args.address ?? (await resolveReusableAddress("vehicle_telemetry", "vehicle_id", args.vehicleId, args.lat, args.lng));
  const result = await pool.query(
    `INSERT INTO vehicle_telemetry (vehicle_id, lat, lng, source, address) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [args.vehicleId, args.lat, args.lng, args.source ?? "whatsapp_location", address],
  );
  return result.rows[0] as VehicleTelemetryPoint;
}

export async function logCrewTelemetry(args: {
  crewMemberId: string;
  lat: number;
  lng: number;
  source?: TelemetrySource;
  address?: string;
}): Promise<CrewTelemetryPoint> {
  const address = args.address ?? (await resolveReusableAddress("crew_telemetry", "crew_member_id", args.crewMemberId, args.lat, args.lng));
  const result = await pool.query(
    `INSERT INTO crew_telemetry (crew_member_id, lat, lng, source, address) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [args.crewMemberId, args.lat, args.lng, args.source ?? "whatsapp_location", address],
  );
  return result.rows[0] as CrewTelemetryPoint;
}

async function resolveReusableAddress(table: string, keyColumn: string, keyValue: string, lat: number, lng: number): Promise<string | null> {
  const result = await pool.query(
    `SELECT lat, lng, address FROM ${table} WHERE ${keyColumn} = $1 AND address IS NOT NULL ORDER BY "timestamp" DESC LIMIT 1`,
    [keyValue],
  );
  const last = result.rows[0];
  if (!last) return null;
  const distance = haversineDistanceMeters(lat, lng, last.lat, last.lng);
  return distance <= GEOCODE_REUSE_RADIUS_METERS ? (last.address as string) : null;
}

export async function listVehicleTelemetry(vehicleId: string, filter?: { since?: string; until?: string }): Promise<VehicleTelemetryPoint[]> {
  const conditions = ["vehicle_id = $1"];
  const params: unknown[] = [vehicleId];
  if (filter?.since) {
    params.push(filter.since);
    conditions.push(`"timestamp" >= $${params.length}`);
  }
  if (filter?.until) {
    params.push(filter.until);
    conditions.push(`"timestamp" <= $${params.length}`);
  }
  const result = await pool.query(
    `SELECT * FROM vehicle_telemetry WHERE ${conditions.join(" AND ")} ORDER BY "timestamp"`,
    params,
  );
  return result.rows as VehicleTelemetryPoint[];
}

// A WhatsApp location share from a crew member logs to crew_telemetry
// always, and to vehicle_telemetry only if exactly one vehicle resolves
// to them as its assigned driver -- both are written from the same
// share, not alternatives, same as v1.
export async function logLocationShare(args: {
  crewMemberId: string;
  lat: number;
  lng: number;
  source?: TelemetrySource;
}): Promise<{ crewTelemetry: CrewTelemetryPoint; vehicleTelemetry: VehicleTelemetryPoint | null }> {
  const crewTelemetry = await logCrewTelemetry(args);

  const vehicles = await pool.query("SELECT id FROM vehicles WHERE assigned_crew_id = $1", [args.crewMemberId]);
  if (vehicles.rowCount !== 1) return { crewTelemetry, vehicleTelemetry: null };

  const vehicleTelemetry = await logVehicleTelemetry({
    vehicleId: vehicles.rows[0].id,
    lat: args.lat,
    lng: args.lng,
    source: args.source,
  });
  return { crewTelemetry, vehicleTelemetry };
}
