-- Generalized confirm-before-execute, re-expressed from
-- dcentral-fieldops's pending_confirmations (see PRECEDENT-ARCHITECTURE.md
-- §3) -- an open registry (src/domain/confirmations.ts's
-- registerConfirmationExecutor), not a CHECK-constrained enum widened by
-- migration every time a new confirmable action is added. action_type stays
-- open TEXT for the same reason.
CREATE TABLE pending_confirmations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type    TEXT NOT NULL, -- e.g. 'timeclock_event' -- maps back to the originating tool
  capability     TEXT NOT NULL, -- the MCP capability id this re-executes, e.g. 'mcp:tool:log_timeclock_event'
  summary        TEXT NOT NULL, -- human-readable, what a reviewer sees
  payload        JSONB NOT NULL, -- args needed to execute the action once approved
  submitted_by   UUID NOT NULL REFERENCES guards(id),
  status         TEXT NOT NULL DEFAULT 'awaiting_review' CHECK (status IN ('awaiting_review', 'approved', 'rejected')),
  reviewed_by    UUID REFERENCES guards(id), -- must hold role IN ('supervisor','admin') -- enforced in src/domain/confirmations.ts, not the DB
  reviewed_at    TIMESTAMPTZ,
  rejection_note TEXT,
  result_id      UUID, -- id of the row actually created once approved (e.g. the new timeclock_entries row)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pending_confirmations_status_idx ON pending_confirmations (status) WHERE status = 'awaiting_review';
