-- Backs the two system self-monitoring alert types that need a stable
-- "singleton status row" id for dedup (backup_failed,
-- dashboard_unreachable) -- same pattern v1 used (a real backup_status
-- row and a real dashboard_url row, each existing purely so
-- alerts.related_record_id has something stable to reference for a
-- tableless, ongoing condition). Combined into one small singleton table
-- here rather than two, since both are just "last known good" timestamps.
-- connectivity_degraded/disk_space_low use fixed sentinel UUID constants
-- instead (src/domain/systemHealth.ts) -- no real backing row, same as
-- v1, since there's even less to track than a timestamp for those.
CREATE TABLE system_status (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_last_success_at      TIMESTAMPTZ,
  dashboard_last_reachable_at TIMESTAMPTZ,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_status DEFAULT VALUES;
