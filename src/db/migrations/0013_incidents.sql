-- Incident reporting (FEATURES.md §4, DOMAIN-DESIGN.md §2). Not adapted
-- from dcentral-fieldops's field_reports.sql (a daily narrative summary
-- per site with workforce/equipment derived live at read time, a
-- genuinely different shape) -- this follows DOMAIN-DESIGN.md §2's own
-- resolved sketch instead: severity/status/an append-only action log.
--
-- category is open TEXT, not a DB enum -- same convention as guards.role,
-- app-enforced, room to grow (theft, trespass, medical, duress, ...)
-- without a migration each time. lat/lng capture where the incident
-- actually happened (also what a duress trigger's location payload lands
-- in -- see DOMAIN-DESIGN.md §3, folded into this table as
-- category = 'duress' rather than a parallel system).
CREATE TYPE incident_severity AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE incident_status AS ENUM ('open', 'escalated', 'resolved');

CREATE TABLE incidents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id               UUID NOT NULL REFERENCES sites(id),
  reported_by_guard_id  UUID NOT NULL REFERENCES guards(id),
  category              TEXT NOT NULL,
  severity              incident_severity NOT NULL,
  status                incident_status NOT NULL DEFAULT 'open',
  summary               TEXT NOT NULL,
  lat                   DOUBLE PRECISION,
  lng                   DOUBLE PRECISION,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ
);

CREATE INDEX incidents_site_id_created_at_idx ON incidents (site_id, created_at DESC);
CREATE INDEX incidents_open_idx ON incidents (status) WHERE status != 'resolved';

-- Append-only, by design (DOMAIN-DESIGN.md §2): a severity bump is a row
-- here (new_severity set), never an UPDATE to incidents.severity -- keeps
-- the property that makes a future tamper-evident hash chain
-- (FEATURES.md §8) meaningful. new_severity is nullable and only
-- meaningful on 'escalated' actions that actually change severity (an
-- escalation note with no severity change leaves it NULL).
CREATE TYPE incident_action_type AS ENUM ('escalated', 'reassigned', 'note_added', 'resolved');

CREATE TABLE incident_actions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id     UUID NOT NULL REFERENCES incidents(id),
  actor_guard_id  UUID NOT NULL REFERENCES guards(id),
  action_type     incident_action_type NOT NULL,
  note            TEXT,
  new_severity    incident_severity,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX incident_actions_incident_id_idx ON incident_actions (incident_id, created_at);
