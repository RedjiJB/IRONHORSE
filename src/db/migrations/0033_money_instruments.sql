-- Re-expressed from v1's `money_instruments`/`money_instrument_custody`
-- tables -- requirements baseline, not copied code. Company cards and
-- petty cash floats. balance is hand-adjusted (a signed delta applied
-- directly), never auto-derived from spend_records -- no automatic
-- reconciliation between "recorded spends on this card" and "the card's
-- tracked balance," same real limitation v1 has.
CREATE TABLE money_instruments (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type    TEXT NOT NULL CHECK (type IN ('company_card', 'petty_cash')),
  label   TEXT NOT NULL,
  balance NUMERIC, -- petty_cash only; NULL for company_card (no running balance concept)
  active  BOOLEAN NOT NULL DEFAULT true
);

-- Who currently holds an instrument -- ended_at IS NULL means "current."
-- No CHECK preventing overlapping custody periods (same real gap v1 has;
-- app-layer discipline via endCustody-before-assignCustody, not enforced
-- at the DB level).
CREATE TABLE money_instrument_custody (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id         UUID NOT NULL REFERENCES money_instruments(id),
  held_by               UUID NOT NULL REFERENCES crew_members(id),
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at              TIMESTAMPTZ,
  assigned_by_user_id   UUID REFERENCES users(id)
);

CREATE INDEX money_instrument_custody_current_idx ON money_instrument_custody (instrument_id) WHERE ended_at IS NULL;
