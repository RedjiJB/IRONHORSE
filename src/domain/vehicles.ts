// Re-expressed from v1's vehicles domain logic -- requirements baseline,
// not copied code. Fully separate from assets/checkouts/loadouts -- a
// vehicle is never an asset row. assigned_crew_id is the only
// vehicle<->crew link; there is no home-depot/home-site field (the
// expected site for geofence purposes is derived transitively through the
// driver's shift, a concern the future alerts/exceptions slice owns, not
// this one).
import { pool } from "../db/pool.js";

export type Vehicle = {
  id: string;
  plate: string;
  assigned_crew_id: string | null;
  current_mileage: string | null;
  created_at: string;
};

export type VehicleTelemetryPoint = {
  id: string;
  vehicle_id: string;
  timestamp: string;
  lat: number;
  lng: number;
  source: string;
  address: string | null;
};

export type VehicleWithLatestLocation = Vehicle & { latest_location: VehicleTelemetryPoint | null };

export async function registerVehicle(args: {
  plate: string;
  assignedCrewId?: string;
  currentMileage?: number;
}): Promise<Vehicle> {
  const result = await pool.query(
    `INSERT INTO vehicles (plate, assigned_crew_id, current_mileage) VALUES ($1, $2, $3) RETURNING *`,
    [args.plate, args.assignedCrewId ?? null, args.currentMileage ?? null],
  );
  return result.rows[0] as Vehicle;
}

// Matches v1's GET /vehicles shape -- pulls each vehicle's single latest
// telemetry row alongside it in one query (LATERAL join), avoiding N+1
// for what's fundamentally a map/dashboard data source.
export async function listVehicles(filter?: { assignedCrewId?: string; plate?: string }): Promise<VehicleWithLatestLocation[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.assignedCrewId) {
    params.push(filter.assignedCrewId);
    conditions.push(`v.assigned_crew_id = $${params.length}`);
  }
  if (filter?.plate) {
    params.push(filter.plate);
    conditions.push(`v.plate = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT v.*, t.latest_location
     FROM vehicles v
     LEFT JOIN LATERAL (
       SELECT to_jsonb(vt) - 'vehicle_id' AS latest_location
       FROM vehicle_telemetry vt
       WHERE vt.vehicle_id = v.id
       ORDER BY vt."timestamp" DESC
       LIMIT 1
     ) t ON true
     ${where}
     ORDER BY v.plate`,
    params,
  );
  return result.rows as VehicleWithLatestLocation[];
}

export async function getVehicle(id: string): Promise<VehicleWithLatestLocation | null> {
  const result = await pool.query(
    `SELECT v.*, t.latest_location
     FROM vehicles v
     LEFT JOIN LATERAL (
       SELECT to_jsonb(vt) - 'vehicle_id' AS latest_location
       FROM vehicle_telemetry vt
       WHERE vt.vehicle_id = v.id
       ORDER BY vt."timestamp" DESC
       LIMIT 1
     ) t ON true
     WHERE v.id = $1`,
    [id],
  );
  return (result.rows[0] as VehicleWithLatestLocation) ?? null;
}
