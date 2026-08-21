-- Re-expressed from v1's `crew_members` table -- phone-number-keyed
-- identity, deliberately NOT DID/VC-based (see docs/ARCHITECTURE.md
-- "D-Central-native architecture layers": known, steady crew don't need
-- cryptographic identity, phone number is already the right-sized answer;
-- a future guerrilla/gig-crew extension is where DID/VC would actually
-- earn its cost, not built here). role is app-validated TEXT, not a
-- Postgres enum, matching v1's own convention for the same column.
CREATE TABLE crew_members (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT UNIQUE NOT NULL,
  role               TEXT NOT NULL DEFAULT 'crew', -- crew, foreman, yard, management, owner, IT
  active             BOOLEAN NOT NULL DEFAULT true,
  preferred_language TEXT, -- 'en'/'fr' or NULL
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at     TIMESTAMPTZ
);
