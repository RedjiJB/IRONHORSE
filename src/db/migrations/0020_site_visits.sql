-- Site visit / spot-check logging (FEATURES.md §3: "supervisor's own
-- geofenced check-in"). A distinct check-in type from a guard's shift
-- check-in (0010_timeclock_entries.sql) -- FEATURES.md §3 calls this out
-- explicitly, and there's a real reason for the split: a guard's own
-- clock-in needs a supervisor to review and approve it (an interested
-- party self-reporting), so it goes through pending_confirmations. A
-- supervisor logging their own spot-check has no analogous second party
-- to approve it, so this is a direct insert, same trust level as a
-- guard's own patrol-run checkpoint scan (checkpoint_scans) -- server
-- resolves geofence_verified from resolveGeofenceVerified, never
-- client-asserted, but there's nobody else who needs to sign off on a
-- supervisor's own presence.
CREATE TABLE site_visits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supervisor_guard_id UUID NOT NULL REFERENCES guards(id),
  site_id             UUID NOT NULL REFERENCES sites(id),
  visited_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  geofence_verified   BOOLEAN NOT NULL,
  lat                 DOUBLE PRECISION,
  lng                 DOUBLE PRECISION,
  note                TEXT
);

CREATE INDEX site_visits_site_id_idx ON site_visits (site_id, visited_at DESC);
CREATE INDEX site_visits_supervisor_guard_id_idx ON site_visits (supervisor_guard_id, visited_at DESC);
