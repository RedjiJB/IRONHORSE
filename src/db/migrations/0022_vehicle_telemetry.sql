-- Re-expressed from v1's `vehicle_telemetry` table -- requirements
-- baseline, not copied code. A location ping, nothing richer -- no
-- ignition state, speed, fuel, or diagnostics exist in this schema
-- either, same deliberate scope as v1. 'obd' is a reserved placeholder
-- for a future hardware integration, never actually written -- the sole
-- real source today is a WhatsApp shared-location message.
CREATE TYPE telemetry_source AS ENUM ('whatsapp_location', 'obd');

CREATE TABLE vehicle_telemetry (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID NOT NULL REFERENCES vehicles(id),
  "timestamp" TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  source     telemetry_source NOT NULL DEFAULT 'whatsapp_location',
  -- Best-effort reverse-geocoded address. The actual Nominatim HTTP call
  -- is Phase 3 (WhatsApp/OpenClaw wiring) scope, not built here -- but the
  -- reuse-if-within-100m decision itself is pure domain logic and *is*
  -- implemented (src/domain/telemetry.ts), since it needs no network call.
  address    TEXT
);

CREATE INDEX vehicle_telemetry_vehicle_id_idx ON vehicle_telemetry (vehicle_id, "timestamp" DESC);
