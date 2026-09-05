-- Patrols/checkpoints (DOMAIN-DESIGN.md §1, resolved 2026-09-04). No
-- direct precedent to adapt from -- dcentral-fieldops has no patrol
-- concept -- this follows the resolved design's own sketch.
--
-- patrol_runs.shift_id is a required, non-nullable FK per the resolved
-- decision: a guard can only start a patrol while tied to a real shift
-- assignment at that site, not ad hoc. A supervisor's own spot-check
-- patrol (FEATURES.md §3) is a distinct check-in type, not a patrol_run --
-- it doesn't need this table at all.
CREATE TABLE patrol_routes (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id   UUID NOT NULL REFERENCES sites(id),
  name      TEXT NOT NULL,
  active    BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX patrol_routes_site_id_idx ON patrol_routes (site_id);

CREATE TYPE checkpoint_verification_method AS ENUM ('qr', 'nfc', 'gps');

CREATE TABLE checkpoints (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_route_id     UUID NOT NULL REFERENCES patrol_routes(id),
  sequence            INTEGER NOT NULL,
  label               TEXT NOT NULL,
  verification_method checkpoint_verification_method NOT NULL,
  qr_or_nfc_token     TEXT, -- only meaningful for 'qr'/'nfc' methods
  lat                 DOUBLE PRECISION, -- only meaningful for 'gps'
  lng                 DOUBLE PRECISION,
  radius_m            INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX checkpoints_patrol_route_id_seq_idx ON checkpoints (patrol_route_id, sequence);

CREATE TYPE patrol_run_status AS ENUM ('in_progress', 'completed', 'abandoned');

CREATE TABLE patrol_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_route_id  UUID NOT NULL REFERENCES patrol_routes(id),
  guard_id         UUID NOT NULL REFERENCES guards(id),
  shift_id         UUID NOT NULL REFERENCES shifts(id), -- required, see header
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  status           patrol_run_status NOT NULL DEFAULT 'in_progress'
);

CREATE INDEX patrol_runs_guard_id_idx ON patrol_runs (guard_id);
CREATE INDEX patrol_runs_shift_id_idx ON patrol_runs (shift_id);

CREATE TABLE checkpoint_scans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patrol_run_id   UUID NOT NULL REFERENCES patrol_runs(id),
  checkpoint_id   UUID NOT NULL REFERENCES checkpoints(id),
  scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified        BOOLEAN NOT NULL,
  exception_note  TEXT
);

CREATE INDEX checkpoint_scans_patrol_run_id_idx ON checkpoint_scans (patrol_run_id);
