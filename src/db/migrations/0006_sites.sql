-- Re-expressed from dcentral-fieldops's `sites` table (see
-- PRECEDENT-ARCHITECTURE.md §6) for IRONHORSE's own site types. center_lat/
-- lng + geofence_radius_m back server-derived geofence verification for
-- guard shift check-in/out (see 0010_timeclock_entries.sql), same pattern
-- as the precedent. geofence_polygon exists for larger commercial sites but
-- polygon checking itself is not implemented here either -- circular-only,
-- same documented gap the precedent carries.
CREATE TYPE site_type AS ENUM ('client_site', 'depot', 'office');

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
