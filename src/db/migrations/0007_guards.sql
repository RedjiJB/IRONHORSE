-- Re-expressed from dcentral-fieldops's `crew_members` table (see
-- PRECEDENT-ARCHITECTURE.md §2/§6), adapted for guards. Unlike the
-- precedent (which added did in a later migration, 0011, because it had
-- existing crew_members rows to backfill against), IRONHORSE has no
-- existing data -- every guard gets a real did:web identity from
-- registration onward, so did is NOT NULL from day one. Custodially held
-- by this node (src/identity/keys.ts), same reasoning as the precedent:
-- a guard interacts through the mobile app with no wallet of their own to
-- hold a private key, phone stays the day-to-day contact/login identifier
-- and is also a signed PhoneBinding credential bound to the guard's DID.
CREATE TABLE guards (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL,
  phone              TEXT UNIQUE NOT NULL,
  role               TEXT NOT NULL DEFAULT 'guard', -- guard, supervisor, admin
  did                TEXT UNIQUE NOT NULL,
  active             BOOLEAN NOT NULL DEFAULT true,
  preferred_language TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at     TIMESTAMPTZ
);
