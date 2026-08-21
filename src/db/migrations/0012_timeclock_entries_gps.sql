-- Persist the raw coordinates a timeclock event was submitted with,
-- alongside the already-existing derived geofence_verified boolean.
-- Explicit instruction: GPS stays plain, available data -- not something
-- to prove-without-revealing. Nullable, matching resolveGeofenceVerified's
-- existing "no lat/lng" fallback path.
ALTER TABLE timeclock_entries ADD COLUMN lat DOUBLE PRECISION;
ALTER TABLE timeclock_entries ADD COLUMN lng DOUBLE PRECISION;
