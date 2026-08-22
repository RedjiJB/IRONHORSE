-- Re-expressed from v1's `consumables` table -- requirements baseline, not
-- copied code. Materials, split into two fundamentally different tracking
-- models via stocking_type:
--   'stocked'          -- bagged/stockable goods kept at a depot with a
--                          reorder threshold (e.g. poly sand). Has a real
--                          quantity_on_hand, adjusted by signed delta.
--   'per_job_delivery' -- bulk landscape materials (sod, topsoil) ordered
--                          fresh per job and delivered directly -- never
--                          stocked, no quantity_on_hand semantics at all.
-- Unlike assets, consumables are never "checked out" -- only consumed or
-- adjusted. Real per-transaction pricing deliberately does not live here;
-- it lives on order_items.unit_cost (0017), since unit cost varies per
-- purchase, not a fixed catalog price.
CREATE TYPE stocking_type AS ENUM ('stocked', 'per_job_delivery');

CREATE TABLE consumables (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  unit                TEXT NOT NULL, -- bag, sqft, cubic_yard, linear_ft, ton, ...
  stocking_type       stocking_type NOT NULL,
  quantity_on_hand    NUMERIC, -- null/unused for per_job_delivery
  reorder_threshold   NUMERIC,
  preferred_vendor_id UUID REFERENCES vendors(id),
  last_verified_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
