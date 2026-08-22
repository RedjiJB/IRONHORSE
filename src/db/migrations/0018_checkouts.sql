-- Re-expressed from v1's `checkouts` table -- requirements baseline, not
-- copied code. Tracks one asset's custody by exactly one crew member at a
-- time.
--
-- Deviation from v1: v1's dual-actor "returned_by / returned_by_user_id"
-- pair exists because v1 has a dashboard-user identity distinct from a
-- crew member's WhatsApp identity. That auth model doesn't exist yet in
-- this system (deferred to the payroll/spending/dashboard-auth slice) --
-- everyone is a crew member DID here, so a single returned_by FK is
-- correct for now. Revisit when dashboard auth lands.
CREATE TABLE checkouts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id            UUID NOT NULL REFERENCES assets(id),
  order_id            UUID REFERENCES orders(id),
  checked_out_by      UUID NOT NULL REFERENCES crew_members(id),
  checked_out_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_at  TIMESTAMPTZ,
  checked_in_at       TIMESTAMPTZ, -- null while outstanding
  damage_flag         BOOLEAN NOT NULL DEFAULT false,
  damage_note         TEXT,
  photo_url           TEXT,
  returned_by         UUID REFERENCES crew_members(id)
);

-- Backs the "one asset, one holder at a time" guarantee: creating a
-- checkout requires the asset to currently be 'available' (checked with a
-- row lock in the same transaction, see src/domain/checkouts.ts) --
-- structurally impossible to double-checkout the same asset.
CREATE INDEX checkouts_asset_id_idx ON checkouts (asset_id);
CREATE INDEX checkouts_outstanding_idx ON checkouts (asset_id) WHERE checked_in_at IS NULL;
