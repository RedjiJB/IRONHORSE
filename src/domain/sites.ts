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
