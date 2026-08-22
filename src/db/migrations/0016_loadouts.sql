-- Re-expressed from v1's `loadouts`/`loadout_items` tables -- requirements
-- baseline, not copied code. A loadout is a named, reusable kit template
-- tied to a job type -- not tied to a specific job or crew member.
CREATE TABLE loadouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  job_type_id UUID REFERENCES job_types(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one of asset_id/consumable_id per row, enforced at the DB level
-- (not just the app layer, unlike v1's app-only check) -- what an item
-- points to is immutable after creation; only quantity/scales_with_crew
-- are ever patched. scales_with_crew items multiply by crew size at
-- *read* time (see resolveLoadout in src/domain/loadouts.ts) -- quantity
-- stored here is always the per-crew-member or flat base number, never
-- the resolved total.
CREATE TABLE loadout_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loadout_id        UUID NOT NULL REFERENCES loadouts(id) ON DELETE CASCADE,
  asset_id          UUID REFERENCES assets(id),
  consumable_id     UUID REFERENCES consumables(id),
  quantity          NUMERIC NOT NULL,
  scales_with_crew  BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT loadout_items_exactly_one_target CHECK (
    (asset_id IS NOT NULL AND consumable_id IS NULL) OR
    (asset_id IS NULL AND consumable_id IS NOT NULL)
  )
);

CREATE INDEX loadout_items_loadout_id_idx ON loadout_items (loadout_id);
