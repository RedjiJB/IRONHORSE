-- Re-expressed from v1's `job_types`/`jobs` tables. A job is a genuine
-- entity, not just a column on shifts -- one site+date+job_type dispatch
-- can span multiple crew members' shifts (multi-team dispatch). Only
-- created when a dispatch actually identifies a job type; a shift without
-- one behaves exactly as before this existed (job_id nullable on shifts,
-- see 0009).
CREATE TABLE job_types (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL
);

CREATE TYPE job_status AS ENUM ('not_started', 'in_progress', 'complete');

CREATE TABLE jobs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id      UUID NOT NULL REFERENCES sites(id),
  job_type_id  UUID REFERENCES job_types(id),
  date         DATE NOT NULL,
  status       job_status NOT NULL DEFAULT 'not_started', -- manual transitions only
  started_at   TIMESTAMPTZ,
  started_by   UUID REFERENCES crew_members(id),
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES crew_members(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed values, matching v1's documented seed set exactly.
INSERT INTO job_types (name) VALUES
  ('interlock_repair'), ('interlock_full_install'), ('sod_install'),
  ('sod_replacement'), ('irrigation_service'), ('seed_and_feed'),
  ('service_call'), ('excavation');
