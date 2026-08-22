-- Re-expressed from v1's `vehicles` table -- requirements baseline, not
-- copied code. Fully separate from the assets/checkouts/loadouts
-- inventory system -- a vehicle is never an asset row, no shared table,
-- no FK between them. assigned_crew_id is the only vehicle<->crew link
-- (a single regular driver, not a fleet-assignment table) -- there is no
-- home-depot/home-site field; a vehicle's "expected site" for geofence
-- purposes is derived transitively through its driver's shift, same as
-- v1. No status enum -- a vehicle simply exists or doesn't.
CREATE TABLE vehicles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plate            TEXT UNIQUE NOT NULL,
  assigned_crew_id UUID REFERENCES crew_members(id),
  current_mileage  NUMERIC, -- manually tracked, no odometer/telemetry auto-update, same as v1
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
