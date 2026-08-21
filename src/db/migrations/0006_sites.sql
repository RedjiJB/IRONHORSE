-- Re-expressed from fieldops-system (v1) docs/DATABASE_SCHEMA.md's `sites`
-- table -- requirements baseline, not copied code. Job sites, depots,
-- vendor locations, and the shop. center_lat/lng + geofence_radius_m back
-- server-derived geofence verification for timeclock events (see
-- 0009_shifts_and_timeclock.sql); geofence_polygon exists for larger
-- commercial sites but polygon checking itself is not implemented here
-- either, same documented gap v1 carried (circular-only).
CREATE TYPE site_type AS ENUM ('job_site', 'depot', 'vendor', 'shop');

CREATE TABLE sites (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  address             TEXT,
  type                site_type NOT NULL,
  access_instructions TEXT,
  access_hours        TEXT,
  center_lat          DOUBLE PRECISION,
  center_lng          DOUBLE PRECISION,
  geofence_radius_m   INTEGER,
  geofence_polygon    JSONB,
  active_start        DATE,
  active_end          DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
