-- Re-expressed from dcentral-fieldops's timeclock_entries (see
-- PRECEDENT-ARCHITECTURE.md §3/§6). lat/lng included from the start
-- (the precedent added these in a later migration, 0012, since it predated
-- the decision) -- geofence_verified is server-derived (see
-- src/domain/timeclock.ts's resolveGeofenceVerified), never client-asserted;
-- no lat/lng, no site geofence configured, or no site_id at all fall through
-- to false.
CREATE TYPE timeclock_event AS ENUM ('in', 'break_start', 'break_end', 'out');

CREATE TABLE timeclock_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guard_id          UUID NOT NULL REFERENCES guards(id),
  event_type        timeclock_event NOT NULL,
  site_id           UUID REFERENCES sites(id),
  "timestamp"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  geofence_verified BOOLEAN NOT NULL DEFAULT false,
  lat               DOUBLE PRECISION,
  lng               DOUBLE PRECISION
);

CREATE INDEX timeclock_entries_guard_id_idx ON timeclock_entries (guard_id);
