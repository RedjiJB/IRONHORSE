-- Runtime mirror of policy/sovereignty_tiers.yaml -- the YAML file is the
-- git-tracked, human-reviewed source of truth; this table is what the MCP
-- invocation middleware actually reads at request time. Kept in sync by a
-- sync script (src/identity/syncSovereigntyPolicy.ts, not yet written) that
-- reads the YAML and upserts here -- never edited directly in the DB.
CREATE TABLE sovereignty_tiers (
  id           TEXT PRIMARY KEY, -- matches the YAML entry's `id`, e.g. 'llm_inference'
  description  TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('external_accepted', 'external_pending', 'self_hosted_required', 'self_hosted_planned')),
  rationale    TEXT NOT NULL,
  reviewed_by  TEXT,
  reviewed_at  TIMESTAMPTZ,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
