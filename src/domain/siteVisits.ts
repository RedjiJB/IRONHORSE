// Site visit / spot-check logging (FEATURES.md §3). See
// 0020_site_visits.sql for why this is a direct insert rather than
// routed through confirmations.ts like a guard's own timeclock event.
import { pool } from "../db/pool.js";
import { resolveGeofenceVerified } from "./timeclock.js";

export type SiteVisit = {
  id: string;
  supervisor_guard_id: string;
  site_id: string;
  visited_at: string;
  geofence_verified: boolean;
  lat: number | null;
  lng: number | null;
  note: string | null;
};

export async function logSiteVisit(args: {
  supervisorGuardId: string;
  siteId: string;
  lat?: number | null;
  lng?: number | null;
  note?: string | null;
}): Promise<SiteVisit> {
  const geofenceVerified = await resolveGeofenceVerified(args.siteId, args.lat, args.lng);
  const result = await pool.query(
    `INSERT INTO site_visits (supervisor_guard_id, site_id, geofence_verified, lat, lng, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [args.supervisorGuardId, args.siteId, geofenceVerified, args.lat ?? null, args.lng ?? null, args.note ?? null],
  );
  return result.rows[0] as SiteVisit;
}

export async function listSiteVisits(filter?: { siteId?: string; supervisorGuardId?: string }): Promise<SiteVisit[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.siteId) {
    params.push(filter.siteId);
    conditions.push(`site_id = $${params.length}`);
  }
  if (filter?.supervisorGuardId) {
    params.push(filter.supervisorGuardId);
    conditions.push(`supervisor_guard_id = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM site_visits ${where} ORDER BY visited_at DESC`, params);
  return result.rows as SiteVisit[];
}

export async function getSiteVisit(id: string): Promise<SiteVisit | null> {
  const result = await pool.query("SELECT * FROM site_visits WHERE id = $1", [id]);
  return (result.rows[0] as SiteVisit) ?? null;
}
