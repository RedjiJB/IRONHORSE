-- Re-expressed from v1's `orders`/`order_items` tables -- requirements
-- baseline, not copied code. A crew request for equipment/materials to be
-- fulfilled, tracked through a fulfillment pipeline distinct from
-- purchasing (see 0020_purchase_orders.sql).
--
-- Deviation from v1, deliberate: v1's order_status has no cancelled/void
-- terminal state at all -- a documented real gap in its own requirements
-- ("no 'cancelled' status exists anywhere in v1"). Added here since it's
-- a genuine correctness gap, not scope creep -- an order that's no longer
-- needed currently has no legal state to move to in v1's model.
CREATE TYPE order_status AS ENUM ('requested', 'confirmed', 'picked', 'loaded', 'in_field', 'returned', 'cancelled');

CREATE TABLE orders (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES crew_members(id),
  site_id      UUID REFERENCES sites(id),
  date_needed  DATE,
  status       order_status NOT NULL DEFAULT 'requested',
  spec_notes   TEXT, -- deliberately free text -- real orders arrive as brand/color/dimension specs, not clean item+qty
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one of asset_id/consumable_id per row, same pattern and same
-- DB-level enforcement as loadout_items.
CREATE TABLE order_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  asset_id      UUID REFERENCES assets(id),
  consumable_id UUID REFERENCES consumables(id),
  quantity      NUMERIC NOT NULL CHECK (quantity > 0),
  -- The real transaction price actually paid for this line -- set after
  -- the fact, independent of any catalog price. Feeds price-history and
  -- order-reconciliation reporting, same as v1.
  unit_cost     NUMERIC CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT order_items_exactly_one_target CHECK (
    (asset_id IS NOT NULL AND consumable_id IS NULL) OR
    (asset_id IS NULL AND consumable_id IS NOT NULL)
  )
);

CREATE INDEX order_items_order_id_idx ON order_items (order_id);
CREATE INDEX orders_status_idx ON orders (status);
