-- Re-expressed from v1's `notification_settings` table -- requirements
-- baseline, not copied code. A true singleton: no id column, exactly one
-- row, seeded here and never re-inserted -- reads take the one row,
-- updates run unconditionally with no WHERE clause, same as v1. Detection
-- thresholds that v1 deliberately keeps as hardcoded constants rather
-- than settings (STALE_TELEMETRY_MINUTES=60, VEHICLE_DARK_HOURS=3 --
-- "detection sensitivity, not a policy call") are NOT columns here
-- either, for the same reason.
CREATE TABLE notification_settings (
  escalation_threshold_minutes  INTEGER NOT NULL DEFAULT 20,
  max_escalations               INTEGER NOT NULL DEFAULT 3,
  vehicle_dark_critical         BOOLEAN NOT NULL DEFAULT false,
  critical_notification_roles   TEXT[] NOT NULL DEFAULT ARRAY['management', 'owner'],
  it_escalation_roles           TEXT[] NOT NULL DEFAULT ARRAY['owner'],
  order_stall_hours             INTEGER NOT NULL DEFAULT 24,
  idle_hours                    INTEGER NOT NULL DEFAULT 2,
  delay_buffer_minutes          INTEGER NOT NULL DEFAULT 30,
  rain_probability_threshold    INTEGER NOT NULL DEFAULT 70,
  wind_speed_threshold_kmh      INTEGER NOT NULL DEFAULT 40,
  daily_overtime_hours          INTEGER NOT NULL DEFAULT 8,   -- payroll-review signal only, NOT wired to any alert -- same as v1
  break_required_after_hours    INTEGER NOT NULL DEFAULT 5,   -- same
  crew_location_stale_minutes   INTEGER NOT NULL DEFAULT 90,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO notification_settings DEFAULT VALUES;
