-- Lone-worker check-in timer (FEATURES.md §2: "auto-alert if no activity
-- in X minutes"). No dcentral-fieldops equivalent -- landscaping crews
-- work in groups, not solo. A guard periodically checks in with an
-- interval of their own choosing (site conditions vary; a fixed
-- system-wide interval would be wrong for most posts), which sets when
-- the *next* one is due. "Overdue" is a read-only query over this table
-- (see listOverdueLoneWorkers in loneWorker.ts), not an active poller --
-- same simplification already flagged for duress.ts's re-page escalation
-- and equipment.ts's overdue-checkout visibility: real-time alerting on
-- expiry needs a recurring poller this pruned tree doesn't have yet, not
-- silently assumed to exist.
CREATE TABLE lone_worker_checkins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id       UUID NOT NULL REFERENCES shifts(id),
  guard_id       UUID NOT NULL REFERENCES guards(id),
  checked_in_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  next_due_at    TIMESTAMPTZ NOT NULL, -- checked_in_at + the interval the guard checked in with
  lat            DOUBLE PRECISION,
  lng            DOUBLE PRECISION
);

CREATE INDEX lone_worker_checkins_shift_id_idx ON lone_worker_checkins (shift_id, checked_in_at DESC);
