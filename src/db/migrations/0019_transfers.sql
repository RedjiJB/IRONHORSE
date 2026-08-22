-- Re-expressed from v1's `transfers` table -- requirements baseline, not
-- copied code. Direct equipment movement site-to-site, bypassing a depot
-- -- a relocation, not a custody handoff (custody stays modeled entirely
-- via checkouts; transfers only ever touches assets.current_site_id).
-- Asset-only by design, same as v1 -- no consumable transfers exist.
--
-- Deviation from v1: adds 'cancelled', same reasoning as orders (0017) --
-- v1's transfer_status is forward-only with no void state, a documented
-- real gap.
CREATE TYPE transfer_status AS ENUM ('requested', 'in_transit', 'completed', 'cancelled');

CREATE TABLE transfers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      UUID NOT NULL REFERENCES assets(id),
  from_site_id  UUID NOT NULL REFERENCES sites(id),
  to_site_id    UUID NOT NULL REFERENCES sites(id),
  requested_by  UUID NOT NULL REFERENCES crew_members(id),
  status        transfer_status NOT NULL DEFAULT 'requested',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
