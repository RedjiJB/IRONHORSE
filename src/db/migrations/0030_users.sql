-- Re-expressed from v1's `users` table -- requirements baseline, not
-- copied code. Dashboard-login identity, entirely separate from
-- crew_members (the WhatsApp/agent identity) -- no FK between them, same
-- person can independently hold a row in both, same as v1.
--
-- Deviation from v1, by explicit instruction: v1's dashboard authorization
-- is a bare `role` string column checked directly (admin/staff/owner) --
-- the exact "trusted role column" pattern already deliberately removed
-- from crew_members in favor of real capability grants. Password login
-- stays (browsers have no identity wallet, and this is a practical login
-- mechanism, not an authorization decision) -- but each user also gets a
-- custodially-held did, and `role` here is a descriptive/display column
-- only, same convention crew_members.role already follows. Real
-- authorization is a capability grant (dashboard:role:staff /
-- dashboard:role:admin), checked the same way crew role authority is
-- (see src/domain/users.ts).
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  did           TEXT UNIQUE NOT NULL,
  role          TEXT NOT NULL DEFAULT 'staff', -- 'admin' | 'staff' | 'owner' -- descriptive only, see comment above
  active        BOOLEAN NOT NULL DEFAULT true, -- deactivated rows kept (FKs from alerts/notifications/spend_records), never deleted
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
