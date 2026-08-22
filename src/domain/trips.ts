// Re-expressed from v1's trips domain logic -- requirements baseline, not
// copied code. Entirely manual/agent-driven -- nothing auto-starts or
// auto-ends a trip. distance_meters/duration_seconds are lower-bound
// estimates from sparse, share-driven telemetry, not GPS-accurate
// tracking, same as v1.
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "./geo.js";

const UNIQUE_VIOLATION = "23505";

export type Trip = {
  id: string;
  vehicle_id: string;
  driver_id: string;
  purpose_tag: string | null;
  site_id: string | null;
  started_at: string;
  ended_at: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
};

export type StartTripResult = { ok: true; trip: Trip } | { ok: false; reason: "vehicle_has_open_trip" };

// The DB's own unique partial index (trips_open_by_vehicle_idx) is what
// actually makes a second open trip for the same vehicle impossible --
// this just turns that constraint violation into a typed result instead
// of a raw Postgres error, same pattern as getOrCreateSelfNode's
// insert-first/catch-23505 handling.
export async function startTrip(args: {
  vehicleId: string;
  driverId: string;
  purposeTag?: string;
  siteId?: string;
}): Promise<StartTripResult> {
  try {
    const result = await pool.query(
      `INSERT INTO trips (vehicle_id, driver_id, purpose_tag, site_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [args.vehicleId, args.driverId, args.purposeTag ?? null, args.siteId ?? null],
    );
    return { ok: true, trip: result.rows[0] as Trip };
  } catch (err) {
    if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
      return { ok: false, reason: "vehicle_has_open_trip" };
    }
    throw err;
  }
}

export type EndTripResult = { ok: true; trip: Trip } | { ok: false; reason: "not_found" | "already_ended" };

// distance_meters sums haversine distance across consecutive
// vehicle_telemetry points for this vehicle within [started_at,
// ended_at] -- fewer than 2 points leaves it NULL ("no data," not "no
// movement," since telemetry is sparse/share-driven, same as v1).
export async function endTrip(tripId: string): Promise<EndTripResult> {
  const tripRow = await pool.query("SELECT * FROM trips WHERE id = $1", [tripId]);
  const trip = tripRow.rows[0] as Trip | undefined;
  if (!trip) return { ok: false, reason: "not_found" };
  if (trip.ended_at) return { ok: false, reason: "already_ended" };

  // Both timestamps must come from the same clock -- comparing a JS
  // Date.now() against a Postgres-originated started_at risks a spurious
  // negative duration under any clock skew between the app and DB hosts.
  // Pulling "now" from Postgres itself, same as started_at, eliminates
  // that entirely.
  const nowRow = await pool.query("SELECT now() AS now");
  const endedAt = nowRow.rows[0].now as Date;
  const durationSeconds = Math.max(0, Math.round((endedAt.getTime() - new Date(trip.started_at).getTime()) / 1000));

  const points = await pool.query(
    `SELECT lat, lng FROM vehicle_telemetry WHERE vehicle_id = $1 AND "timestamp" >= $2 AND "timestamp" <= $3 ORDER BY "timestamp"`,
    [trip.vehicle_id, trip.started_at, endedAt],
  );
  let distanceMeters: number | null = null;
  if (points.rowCount != null && points.rowCount >= 2) {
    distanceMeters = 0;
    for (let i = 1; i < points.rows.length; i++) {
      distanceMeters += haversineDistanceMeters(
        points.rows[i - 1].lat, points.rows[i - 1].lng,
        points.rows[i].lat, points.rows[i].lng,
      );
    }
  }

  const result = await pool.query(
    `UPDATE trips SET ended_at = $2, duration_seconds = $3, distance_meters = $4 WHERE id = $1 RETURNING *`,
    [tripId, endedAt, durationSeconds, distanceMeters],
  );
  return { ok: true, trip: result.rows[0] as Trip };
}

export async function listTrips(filter?: { vehicleId?: string; driverId?: string }): Promise<Trip[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.vehicleId) {
    params.push(filter.vehicleId);
    conditions.push(`vehicle_id = $${params.length}`);
  }
  if (filter?.driverId) {
    params.push(filter.driverId);
    conditions.push(`driver_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM trips ${where} ORDER BY started_at DESC`, params);
  return result.rows as Trip[];
}
