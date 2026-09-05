-- Weapon/equipment issue log (FEATURES.md §2). Re-expressed from
-- dcentral-fieldops's assets.ts + checkouts.ts (PRECEDENT-ARCHITECTURE.md
-- §6) -- requirements baseline, not copied code, and deliberately
-- simplified: the precedent's assets.ts gates a brand-new asset behind a
-- physical-verification confirm-before-execute flow before it's ever
-- 'available' (new assets start 'unconfirmed'). That's a real, reasonable
-- extension for a weapons register specifically, but FEATURES.md only
-- asks for "checkout/return with signature confirmation" -- this starts
-- new equipment directly 'available', flagged here as a follow-up worth
-- considering, not silently dropped.
CREATE TYPE equipment_status AS ENUM ('available', 'checked_out', 'in_maintenance', 'missing', 'retired');

CREATE TABLE equipment (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  category            TEXT NOT NULL, -- 'firearm' | 'radio' | 'vest' | 'flashlight' | ... -- app-enforced, not a DB enum, same convention as guards.role
  serial_number       TEXT,
  site_id             UUID REFERENCES sites(id), -- home site, nullable (some equipment isn't site-assigned)
  status              equipment_status NOT NULL DEFAULT 'available',
  current_holder_guard_id UUID REFERENCES guards(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX equipment_status_idx ON equipment (status);
CREATE INDEX equipment_site_id_idx ON equipment (site_id);

-- Tracks one item's custody by exactly one guard at a time -- the
-- checkouts.ts "structurally impossible double-checkout" guarantee comes
-- from requiring equipment.status = 'available' under a row lock in the
-- same transaction that creates this row (see src/domain/equipment.ts),
-- not just application discipline.
--
-- A checkout's return -- specifically any condition/damage claim on it --
-- isn't independently verifiable from the guard's own report, so it goes
-- through the same two-party confirm-before-execute pattern as timeclock
-- events ("signature confirmation" per FEATURES.md §2: a supervisor
-- reviews and signs off before the return actually executes).
CREATE TABLE equipment_checkouts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id          UUID NOT NULL REFERENCES equipment(id),
  checked_out_by_guard_id UUID NOT NULL REFERENCES guards(id),
  checked_out_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expected_return_at    TIMESTAMPTZ,
  checked_in_at         TIMESTAMPTZ, -- null while outstanding
  condition_flag        BOOLEAN NOT NULL DEFAULT false, -- damage/issue reported at return
  condition_note        TEXT,
  returned_by_guard_id  UUID REFERENCES guards(id)
);

CREATE INDEX equipment_checkouts_equipment_id_idx ON equipment_checkouts (equipment_id);
CREATE INDEX equipment_checkouts_outstanding_idx ON equipment_checkouts (equipment_id) WHERE checked_in_at IS NULL;
