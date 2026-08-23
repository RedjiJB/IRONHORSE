// Re-expressed from v1's vehicle_telemetry/crew_telemetry domain logic --
// requirements baseline, not copied code. A location ping, nothing
// richer -- no ignition state, speed, fuel, or diagnostics exist here
// either.
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "./geo.js";

export type ReverseGeocode = (lat: number, lng: number) => Promise<string | null>;

// Nominatim -- free, no API key, per policy/sovereignty_tiers.yaml's
// existing external_accepted decision for reverse geocoding (reviewed
// 2026-08-21: the coordinate, not its formatted address, is the
// sensitive part, and the coordinate already has to exist in this
// system regardless). Usage policy requires a descriptive User-Agent
// identifying the application -- requests without one risk being
// blocked -- and at most ~1 req/sec, which the reuse-if-nearby cache
// below keeps this well under in practice (a resolved address is never
// re-requested for a point within GEOCODE_REUSE_RADIUS_METERS of it).
// Fails silently on any error/timeout, same posture as the weather
// fetch in exceptions.ts -- a geocoding hiccup should never block the
// telemetry write itself. Exported as a default rather than called
// directly everywhere below (mirrors exceptions.ts's fetchOpenMeteoForecast/
// FetchForecast pattern) so tests can inject a fake and never touch the
// real network.
export const reverseGeocodeViaNominatim: ReverseGeocode = async (lat, lng) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=0`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "dcentral-fieldops (Sod Boys Ltd internal field-ops tool)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string };
    return data.display_name?.trim() || null;
  } catch {
    return null;
  }
};

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
}, geocode: ReverseGeocode = reverseGeocodeViaNominatim): Promise<VehicleTelemetryPoint> {
  const address = args.address
    ?? (await resolveReusableAddress("vehicle_telemetry", "vehicle_id", args.vehicleId, args.lat, args.lng))
    ?? (await geocode(args.lat, args.lng));
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
}, geocode: ReverseGeocode = reverseGeocodeViaNominatim): Promise<CrewTelemetryPoint> {
  const address = args.address
    ?? (await resolveReusableAddress("crew_telemetry", "crew_member_id", args.crewMemberId, args.lat, args.lng))
    ?? (await geocode(args.lat, args.lng));
  const result = await pool.query(
    `INSERT INTO crew_telemetry (crew_member_id, lat, lng, source, address) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [args.crewMemberId, args.lat, args.lng, args.source ?? "whatsapp_location", address],
  );
  return result.rows[0] as CrewTelemetryPoint;
}

// Backfill for a telemetry row that predates this function, or was
// logged with a caller-supplied address that later turned out null --
// resolves and persists the address in place so a later read (the
// equipment façade route) never re-requests it. No-ops if the row
// already has an address or doesn't exist.
export async function ensureVehicleTelemetryAddress(
  telemetryId: string,
  lat: number,
  lng: number,
  geocode: ReverseGeocode = reverseGeocodeViaNominatim,
): Promise<string | null> {
  const address = await geocode(lat, lng);
  if (!address) return null;
  await pool.query(`UPDATE vehicle_telemetry SET address = $2 WHERE id = $1 AND address IS NULL`, [telemetryId, address]);
  return address;
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
}, geocode: ReverseGeocode = reverseGeocodeViaNominatim): Promise<{ crewTelemetry: CrewTelemetryPoint; vehicleTelemetry: VehicleTelemetryPoint | null }> {
  const crewTelemetry = await logCrewTelemetry(args, geocode);

  const vehicles = await pool.query("SELECT id FROM vehicles WHERE assigned_crew_id = $1", [args.crewMemberId]);
  if (vehicles.rowCount !== 1) return { crewTelemetry, vehicleTelemetry: null };

  const vehicleTelemetry = await logVehicleTelemetry({
    vehicleId: vehicles.rows[0].id,
    lat: args.lat,
    lng: args.lng,
    source: args.source,
  }, geocode);
  return { crewTelemetry, vehicleTelemetry };
}
