-- Generalized confirm-before-execute -- v1's hard-coded 7-tool pilot
-- (pending_confirmations with a CHECK-constrained action_type enum widened
-- three separate times as the pilot grew) re-expressed as a declared MCP
-- tool property instead: any tool can opt in by setting
-- requiresIndependentConfirmation in its registration (see
-- src/mcp/confirmable.ts), enforced generically by one middleware rather
-- than each route hand-rolling the pattern. action_type stays open TEXT,
-- not a CHECK enum -- the whole point of "generalized" is a new
-- confirmable tool needs no migration.
--
-- No separate notifications table backing this yet (v1's pending_confirmations
-- links to a real notifications row for escalation) -- notifications/alerts
-- are later Phase 2 scope (see docs/ARCHITECTURE.md's deferred list).
-- Escalation is real future work, not lost, just not built in this slice.
CREATE TABLE pending_confirmations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type    TEXT NOT NULL, -- e.g. 'timeclock_event' -- maps back to the originating tool
  capability     TEXT NOT NULL, -- the MCP capability id this re-executes, e.g. 'mcp:tool:log_timeclock_event'
  summary        TEXT NOT NULL, -- human-readable, what a reviewer sees
  payload        JSONB NOT NULL, -- args needed to execute the action once approved
  submitted_by   UUID NOT NULL REFERENCES crew_members(id),
  status         TEXT NOT NULL DEFAULT 'awaiting_review' CHECK (status IN ('awaiting_review', 'approved', 'rejected')),
  reviewed_by    UUID REFERENCES crew_members(id), -- must hold role IN ('management','owner') -- enforced in src/domain/confirmations.ts, not the DB
  reviewed_at    TIMESTAMPTZ,
  rejection_note TEXT,
  result_id      UUID, -- id of the row actually created once approved (e.g. the new timeclock_entries row)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX pending_confirmations_status_idx ON pending_confirmations (status) WHERE status = 'awaiting_review';
