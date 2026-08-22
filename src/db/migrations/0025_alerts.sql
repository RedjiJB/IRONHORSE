-- Re-expressed from v1's `alerts` table -- requirements baseline, not
-- copied code. related_record_id is a bare, untyped UUID -- which table
-- it points at is inferred entirely from `type`, same polymorphic
-- pattern v1 used (a real design smell, but replicated faithfully since
-- every reader already has to know this mapping):
--   overdue -> checkouts.id            order_stalled -> orders.id
--   idle / crew_location_stale /
--     crew_off_site                    -> crew_members.id
--   wrong_site / vehicle_dark          -> vehicles.id
--   delay                             -> shifts.id
--   loadout_gap                       -> jobs.id
--   maintenance_due                   -> assets.id
--   weather                           -> sites.id (same as site_id)
--   backup_failed / dashboard_unreachable -> a singleton status row's id
--   connectivity_degraded / disk_space_low -> fixed sentinel UUIDs (no
--     real backing row; exists only so dedup has something stable)
--   it_issue / system_offline / cron_job_failed -> NULL (freeform reports
--     with no backing record; NULL deliberately never dedups)
--
-- Deviation from v1, deliberate: adds `severity` directly on the alert
-- row. v1 only ever decided critical-vs-routine transiently at
-- notification-creation time (a static Set in its exceptions worker,
-- never persisted on the alert itself) -- v1's own requirements flagged
-- this as a real gap ("worth fixing in the rewrite"). Closing it here,
-- not scope creep.
CREATE TYPE alert_type AS ENUM (
  'idle', 'delay', 'wrong_site', 'order_stalled', 'loadout_gap', 'overdue',
  'vehicle_dark', 'weather', 'dashboard_unreachable', 'maintenance_due',
  'backup_failed', 'cron_job_failed', 'connectivity_degraded', 'disk_space_low',
  'it_issue', 'system_offline', 'crew_location_stale', 'crew_off_site'
);

CREATE TYPE alert_severity AS ENUM ('critical', 'routine');

CREATE TABLE alerts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type               alert_type NOT NULL,
  severity           alert_severity NOT NULL,
  site_id            UUID REFERENCES sites(id), -- nullable -- NULL for site-less alerts (backup, IT infra)
  related_record_id  UUID, -- untyped polymorphic reference, see above -- no FK constraint possible
  raised_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at        TIMESTAMPTZ,
  resolved_by        UUID REFERENCES crew_members(id)
  -- No resolved_by_user_id yet -- same deferred-dual-actor note as
  -- checkouts/purchase_orders: that pairing exists in v1 because it has a
  -- dashboard-user identity distinct from crew. Not built here yet.
);

-- Backs the dedup query every alert check runs before raising: "is there
-- already an open alert of this type for this record."
CREATE INDEX alerts_dedup_idx ON alerts (type, related_record_id) WHERE resolved_at IS NULL;
CREATE INDEX alerts_open_idx ON alerts (resolved_at) WHERE resolved_at IS NULL;
