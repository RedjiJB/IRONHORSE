-- Re-expressed from v1's `assets` table -- requirements baseline, not
-- copied code. Durable, serialized/trackable equipment, one row per
-- physical item.
--
-- Golden rule carried forward from v1, enforced at the domain layer
-- (src/domain/assets.ts), not just documented here: an asset is never
-- usable (never assignable to a loadout, never checked out) until it has
-- been physically verified at least once. New assets always start
-- 'unconfirmed'; 'available' is reachable *only* through the two-party
-- confirm-before-execute asset_verification flow (see
-- src/domain/confirmations.ts) -- a crew member's own "I checked it, it's
-- fine" claim isn't independent verification of anything, same reasoning
-- already applied to timeclock events. There is no direct route to set
-- status='available'.
CREATE TYPE asset_status AS ENUM ('unconfirmed', 'available', 'checked_out', 'missing', 'in_maintenance', 'retired');

CREATE TABLE assets (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT NOT NULL,
  category               TEXT,
  qr_tag_id              TEXT UNIQUE,
  purchase_date          DATE,
  condition              TEXT,
  current_site_id        UUID REFERENCES sites(id),
  current_holder         UUID REFERENCES crew_members(id),
  status                 asset_status NOT NULL DEFAULT 'unconfirmed',
  last_verified_at       TIMESTAMPTZ,
  verified_by            UUID REFERENCES crew_members(id),
  -- Calendar-interval maintenance only, same deliberate scope as v1 -- no
  -- odometer/usage/hours tracking exists. NULL means no schedule
  -- configured, not "due now"; next-due is computed at query time, never
  -- stored (see resolveNextServiceDue in src/domain/assets.ts).
  service_interval_days  INTEGER,
  last_serviced_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX assets_status_idx ON assets (status);
