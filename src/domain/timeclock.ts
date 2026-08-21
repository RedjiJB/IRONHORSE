// Ported from v1 (fieldops-system) backend/src/routes/shifts.ts's
// resolveGeofenceVerified -- same behavior, re-expressed for this schema.
// No site_id, no site geofence configured, or no lat/lng all fall through
// to false; there is no path to assert true without real coordinates.
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "./geo.js";
import { registerConfirmationExecutor } from "./confirmations.js";

export type TimeclockEventType = "in" | "break_start" | "break_end" | "out";

export async function resolveGeofenceVerified(
  siteId: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
): Promise<boolean> {
  if (!siteId || lat == null || lng == null) return false;
  const result = await pool.query(
    "SELECT center_lat, center_lng, geofence_radius_m FROM sites WHERE id = $1",
    [siteId],
  );
  const site = result.rows[0];
  if (!site || site.center_lat == null || site.center_lng == null || site.geofence_radius_m == null) {
    return false;
  }
  return haversineDistanceMeters(lat, lng, site.center_lat, site.center_lng) <= site.geofence_radius_m;
}

export type TimeclockEntry = {
  id: string;
  crew_member_id: string;
  event_type: TimeclockEventType;
  site_id: string | null;
  timestamp: string;
  geofence_verified: boolean;
  lat: number | null;
  lng: number | null;
};

// The actual effect -- called either directly, or by the confirmation-
// approval handler once a management-role review has happened. Takes
// geofenceVerified as an already-resolved boolean rather than lat/lng,
// so the same function serves both "verify now, at submission time" (the
// tool handler) and "re-verify against payload, at approval time" (the
// approval handler) without resolving twice or trusting a stale value.
export async function createTimeclockEntry(args: {
  crewMemberId: string;
  eventType: TimeclockEventType;
  siteId?: string | null;
  geofenceVerified: boolean;
  lat?: number | null;
  lng?: number | null;
}): Promise<TimeclockEntry> {
  const result = await pool.query(
    `INSERT INTO timeclock_entries (crew_member_id, event_type, site_id, geofence_verified, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [args.crewMemberId, args.eventType, args.siteId ?? null, args.geofenceVerified, args.lat ?? null, args.lng ?? null],
  );
  return result.rows[0] as TimeclockEntry;
}

export async function listTimeclockEntries(crewMemberId: string): Promise<TimeclockEntry[]> {
  const result = await pool.query(
    "SELECT * FROM timeclock_entries WHERE crew_member_id = $1 ORDER BY timestamp DESC",
    [crewMemberId],
  );
  return result.rows as TimeclockEntry[];
}

// Registered once at server startup (see src/mcp/tools/timeclock.ts) --
// the executor a management-role approval actually runs. Re-resolves
// geofence_verified fresh from the payload's lat/lng against current site
// state, rather than trusting whatever was true at submission time.
export function registerTimeclockConfirmationExecutor(): void {
  registerConfirmationExecutor("timeclock_event", async (payload) => {
    const crewMemberId = payload.crewMemberId as string;
    const eventType = payload.eventType as TimeclockEventType;
    const siteId = (payload.siteId as string | null) ?? null;
    const lat = payload.lat as number | null | undefined;
    const lng = payload.lng as number | null | undefined;
    const geofenceVerified = await resolveGeofenceVerified(siteId, lat, lng);
    const entry = await createTimeclockEntry({ crewMemberId, eventType, siteId, geofenceVerified, lat, lng });
    return { resultId: entry.id };
  });
}
