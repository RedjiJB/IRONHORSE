-- Re-expressed from v1's `shifts`/`timeclock_entries` tables -- the actual
-- backbone of a dispatch system. nudged_at/reminder_sent_at kept even
-- though the notifier scripts that set them (nudge-shifts.mjs,
-- shift-reminder.mjs) are Phase 3 work, not built yet -- the column exists
-- so that work is additive later, not a migration.
CREATE TYPE shift_status AS ENUM ('assigned', 'confirmed', 'declined', 'no_show');

CREATE TABLE shifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id   UUID NOT NULL REFERENCES crew_members(id),
  site_id          UUID NOT NULL REFERENCES sites(id),
  date             DATE NOT NULL,
  start_time       TIME,
  end_time         TIME,
  status           shift_status NOT NULL DEFAULT 'assigned',
  nudged_at        TIMESTAMPTZ,
  reminder_sent_at TIMESTAMPTZ,
  job_id           UUID REFERENCES jobs(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX shifts_crew_member_id_date_idx ON shifts (crew_member_id, date);
CREATE INDEX shifts_site_id_date_idx ON shifts (site_id, date);

CREATE TYPE timeclock_event AS ENUM ('in', 'break_start', 'break_end', 'out');

-- geofence_verified is server-derived (see src/domain/timeclock.ts's
-- resolveGeofenceVerified, ported from v1's backend/src/routes/shifts.ts
-- function of the same name/behavior), never client-asserted -- no lat/lng,
-- no site geofence configured, or no site_id at all all fall through to
-- false. There is no path left to assert true without real coordinates.
CREATE TABLE timeclock_entries (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id    UUID NOT NULL REFERENCES crew_members(id),
  event_type        timeclock_event NOT NULL,
  site_id           UUID REFERENCES sites(id),
  "timestamp"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  geofence_verified BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX timeclock_entries_crew_member_id_idx ON timeclock_entries (crew_member_id);
