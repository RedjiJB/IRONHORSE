-- Restoring Field Reports, Slice S: re-scoped from the vendored page's
-- project_id (27 references throughout, no project concept exists here)
-- to site_id. Only the genuinely new content -- the narrative notes --
-- lives in this table; workforce (who was clocked in) and equipment
-- (which vehicles had a telemetry ping) are derived live from
-- timeclock_entries/vehicle_telemetry at read time, never duplicated
-- into a second, divergent record here.
--
-- created_by references users, not crew_members -- a field report is
-- authored from the dashboard by a staff/admin user, same reasoning
-- 0036_alerts_notifications_user_actor.sql gave for its own
-- *_by_user_id columns.
CREATE TABLE field_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id),
  report_date  DATE NOT NULL,
  notes        TEXT NOT NULL,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX field_reports_site_id_date_idx ON field_reports (site_id, report_date);
