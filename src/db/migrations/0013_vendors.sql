-- Re-expressed from v1's `vendors` table -- requirements baseline, not
-- copied code. Reference data only; no vendor API integration exists here
-- either, same deliberate scope decision v1 documented (a PO only ever
-- routes information to a human).
CREATE TABLE vendors (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  contact_method   TEXT,
  contact_address  TEXT,
  account_number   TEXT,
  lead_time_days   INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
