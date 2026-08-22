-- Re-expressed from v1's `purchase_orders`/`purchase_order_items` tables
-- -- requirements baseline, not copied code. Compiled from an order's
-- order_items (see compilePurchaseOrder in src/domain/purchaseOrders.ts).
-- Deliberately no vendor API integration, same as v1 -- a PO only ever
-- routes information to a human (an email address or a picker's
-- contact), nothing here ever contacts a vendor programmatically.
--
-- Deviation from v1: adds 'cancelled', same reasoning as orders/transfers.
-- Also: v1 duplicates the fulfillment state-transition logic between its
-- direct dashboard route and its confirm-before-execute approval path --
-- this system keeps exactly one implementation
-- (registerPurchaseOrderFulfillmentExecutor in src/domain/purchaseOrders.ts),
-- since purchase_order_fulfillment is one of the two-party-confirmed
-- action types (a crew member's own "it arrived" claim isn't independent
-- verification), not something with a separate always-trusted direct path.
CREATE TYPE po_status AS ENUM ('compiled', 'sent_to_office', 'forwarded_by_office', 'fulfilled', 'cancelled');

CREATE TABLE purchase_orders (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id     UUID REFERENCES vendors(id),
  order_id      UUID REFERENCES orders(id),
  status        po_status NOT NULL DEFAULT 'compiled',
  cost          NUMERIC,
  eta           DATE,
  sent_to       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at  TIMESTAMPTZ,
  fulfilled_by  UUID REFERENCES crew_members(id)
);

CREATE TABLE purchase_order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  description        TEXT NOT NULL, -- free text, may include full brand/spec -- flattened from the source order_item
  quantity           NUMERIC,
  order_item_id      UUID REFERENCES order_items(id) -- forward-only link back to the specific requested line, for reconciliation
);

CREATE INDEX purchase_order_items_po_id_idx ON purchase_order_items (purchase_order_id);
