import { pool } from "../db/pool.js";

export type SiteType = "client_site" | "depot" | "office";

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

export type SiteWithActivityCounts = Site & { guards_on_duty_count: number };

// Basis for the supervisor live-roster / dispatcher-dashboard site cards
// (FEATURES.md §3/§6) -- distinct guards who clocked in at this site today
// (calendar day), not "currently still clocked in" (that needs per-guard
// latest-event resolution, a heavier query for a summary tile that doesn't
// need that precision -- same tradeoff the precedent's
// listSitesWithActivityCounts makes).
export async function listSitesWithActivityCounts(): Promise<SiteWithActivityCounts[]> {
  const result = await pool.query(
    `SELECT s.*, COALESCE(t.guards_on_duty_count, 0) AS guards_on_duty_count
     FROM sites s
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT guard_id)::int AS guards_on_duty_count
       FROM timeclock_entries te
       WHERE te.site_id = s.id AND te.event_type = 'in' AND te."timestamp" >= date_trunc('day', now())
     ) t ON true
     ORDER BY s.name`,
  );
  return result.rows as SiteWithActivityCounts[];
}
