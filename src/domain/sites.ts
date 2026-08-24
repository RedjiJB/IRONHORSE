import { pool } from "../db/pool.js";

export type SiteType = "job_site" | "depot" | "vendor" | "shop";

export type Site = {
  id: string;
  name: string;
  address: string | null;
  type: SiteType;
  access_instructions: string | null;
  access_hours: string | null;
  center_lat: number | null;
  center_lng: number | null;
  geofence_radius_m: number | null;
  geofence_polygon: unknown | null;
  active_start: string | null;
  active_end: string | null;
  created_at: string;
};

export async function registerSite(args: {
  name: string;
  type: SiteType;
  address?: string;
  centerLat?: number;
  centerLng?: number;
  geofenceRadiusM?: number;
}): Promise<Site> {
  const result = await pool.query(
    `INSERT INTO sites (name, type, address, center_lat, center_lng, geofence_radius_m)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [args.name, args.type, args.address ?? null, args.centerLat ?? null, args.centerLng ?? null, args.geofenceRadiusM ?? null],
  );
  return result.rows[0] as Site;
}

export async function listSites(filter?: { type?: SiteType }): Promise<Site[]> {
  if (filter?.type) {
    const result = await pool.query("SELECT * FROM sites WHERE type = $1 ORDER BY name", [filter.type]);
    return result.rows as Site[];
  }
  const result = await pool.query("SELECT * FROM sites ORDER BY name");
  return result.rows as Site[];
}

export async function getSite(id: string): Promise<Site | null> {
  const result = await pool.query("SELECT * FROM sites WHERE id = $1", [id]);
  return (result.rows[0] as Site) ?? null;
}

export type SiteWithActivityCounts = Site & { crew_today_count: number; open_alerts_count: number };

// Dashboard restoration, Slice M: for the site cards widget -- one query,
// LATERAL joins, same pattern as listVehicles()'s latest-telemetry join,
// avoiding N+1 for a dashboard data source. crew_today_count is distinct
// crew who clocked in at this site today (calendar day, not "currently
// still clocked in" -- that would need per-crew latest-event resolution,
// a heavier query for a summary tile that doesn't need that precision).
export async function listSitesWithActivityCounts(): Promise<SiteWithActivityCounts[]> {
  const result = await pool.query(
    `SELECT s.*,
       COALESCE(c.crew_today_count, 0) AS crew_today_count,
       COALESCE(a.open_alerts_count, 0) AS open_alerts_count
     FROM sites s
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT crew_member_id)::int AS crew_today_count
       FROM timeclock_entries te
       WHERE te.site_id = s.id AND te.event_type = 'in' AND te."timestamp" >= date_trunc('day', now())
     ) c ON true
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS open_alerts_count
       FROM alerts al
       WHERE al.site_id = s.id AND al.resolved_at IS NULL
     ) a ON true
     ORDER BY s.name`,
  );
  return result.rows as SiteWithActivityCounts[];
}
