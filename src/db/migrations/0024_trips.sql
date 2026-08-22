-- Re-expressed from v1's `trips` table -- requirements baseline, not
-- copied code. Entirely manual/agent-driven, not automatic -- nothing
-- auto-starts or auto-ends a trip on shift start or geofence entry. No
-- status enum -- a trip's state is derived purely from ended_at IS NULL.
-- distance_meters/duration_seconds are lower-bound estimates from sparse,
-- share-driven telemetry, not GPS-accurate tracking, same as v1.
CREATE TABLE trips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       UUID NOT NULL REFERENCES vehicles(id),
  driver_id        UUID NOT NULL REFERENCES crew_members(id),
  purpose_tag      TEXT, -- free text, e.g. "dump run" -- driver-supplied, no enum, same as v1
  site_id          UUID REFERENCES sites(id),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at         TIMESTAMPTZ, -- NULL = trip still open
  distance_meters  DOUBLE PRECISION, -- NULL (not 0) if fewer than 2 telemetry points fell in the trip window
  duration_seconds INTEGER
);

-- Enforces "one open trip per vehicle at a time" at the DB level -- a
-- unique partial index, not just an app-layer check, same bar as
-- checkouts' single-holder guarantee (structurally impossible to violate,
-- not just application discipline).
CREATE UNIQUE INDEX trips_open_by_vehicle_idx ON trips (vehicle_id) WHERE ended_at IS NULL;
