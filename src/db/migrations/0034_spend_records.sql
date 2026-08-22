-- Re-expressed from v1's `spend_records` table -- requirements baseline,
-- not copied code. category is app-validated (material | fuel | mileage
-- | receipt | other), not a DB enum, matching v1's own choice (kept
-- flexible for a slower-changing money-classification concept vs.
-- method's DB CHECK). status defaults 'approved' -- only
-- method='personal_reimbursed' starts 'pending' (needs sign-off before
-- trusted); everything else is a record of money already spent, trusted
-- immediately, same as v1.
CREATE TABLE spend_records (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category              TEXT NOT NULL, -- app-validated: material | fuel | mileage | receipt | other
  method                TEXT NOT NULL CHECK (method IN ('cash', 'company_card', 'personal_reimbursed')),
  status                TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'disputed')) DEFAULT 'approved',
  amount                NUMERIC CHECK (amount IS NULL OR amount >= 0), -- null only while a pending mileage claim awaits a rate
  distance_km           NUMERIC CHECK (distance_km IS NULL OR distance_km >= 0), -- mileage only
  rate_per_km           NUMERIC CHECK (rate_per_km IS NULL OR rate_per_km >= 0), -- set at approval time, not submission -- mileage only
  description           TEXT,
  document_id           UUID REFERENCES documents(id),
  instrument_id         UUID REFERENCES money_instruments(id),
  crew_member_id        UUID REFERENCES crew_members(id), -- the subject of the spend
  submitted_by          UUID REFERENCES crew_members(id),
  submitted_by_user_id  UUID REFERENCES users(id),
  occurred_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_by           UUID REFERENCES crew_members(id),
  reviewed_by_user_id   UUID REFERENCES users(id),
  reviewed_at           TIMESTAMPTZ,
  rejection_note        TEXT,
  dispute_note          TEXT,
  disputed_at           TIMESTAMPTZ, -- permanent marker, bounds appeal to exactly one round
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX spend_records_crew_member_id_idx ON spend_records (crew_member_id);
CREATE INDEX spend_records_status_idx ON spend_records (status);
-- Backs the "missing receipts" check: approved, non-mileage, no linked document.
CREATE INDEX spend_records_missing_receipts_idx ON spend_records (id) WHERE document_id IS NULL AND status = 'approved';
