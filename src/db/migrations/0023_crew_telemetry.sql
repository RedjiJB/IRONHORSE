-- Re-expressed from v1's `crew_telemetry` table -- requirements baseline,
-- not copied code. The person-level analog of vehicle_telemetry, same
-- exact shape, keyed to a crew member instead of a vehicle -- exists so a
-- crew member has their own location stream independent of any vehicle
-- (a carpool passenger, or someone with no assigned vehicle at all). A
-- WhatsApp location share from a crew member logs here always, and to
-- vehicle_telemetry only if exactly one vehicle resolves to that crew
-- member as its assigned driver (see logLocationShare in
-- src/domain/telemetry.ts) -- both are written from the same share, not
-- alternatives.
CREATE TABLE crew_telemetry (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  crew_member_id UUID NOT NULL REFERENCES crew_members(id),
  "timestamp"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  source         telemetry_source NOT NULL DEFAULT 'whatsapp_location',
  address        TEXT
);

CREATE INDEX crew_telemetry_crew_member_id_idx ON crew_telemetry (crew_member_id, "timestamp" DESC);
