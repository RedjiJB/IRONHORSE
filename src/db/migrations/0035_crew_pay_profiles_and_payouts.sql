-- Re-expressed from v1's `crew_pay_profiles`/`payouts` tables --
-- requirements baseline, not copied code. No real payroll processing
-- exists here either -- no pay run, no direct-deposit integration, no
-- tax withholding, no pay stubs. payouts is a manual "I paid this person"
-- log an admin types in after paying someone outside the system; the app
-- never moves money. crew_pay_profiles is "what someone is paid" (a
-- rate); payouts is "what they were actually paid" (a log entry) --
-- deliberately independent tables, reconciled only by a computed view
-- (src/domain/payroll.ts's computeReconciliation), never stored.
CREATE TABLE crew_pay_profiles (
  crew_member_id  UUID PRIMARY KEY REFERENCES crew_members(id),
  pay_type        TEXT NOT NULL DEFAULT 'payroll' CHECK (pay_type IN ('payroll', 'cash')),
  hourly_rate     NUMERIC CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id        UUID NOT NULL REFERENCES crew_members(id),
  amount                NUMERIC NOT NULL CHECK (amount > 0),
  paid_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  note                  TEXT,
  recorded_by_user_id   UUID NOT NULL REFERENCES users(id), -- always a dashboard admin, no agent/crew path at all, same as v1
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX payouts_crew_member_id_idx ON payouts (crew_member_id, paid_at);
