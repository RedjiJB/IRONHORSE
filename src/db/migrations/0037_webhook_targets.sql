-- Restoring the vendored "Notification Webhooks" admin page for real: an
-- outbound HTTP endpoint that receives matching notification events as
-- they happen. secret is stored in cleartext (not hashed) since it must
-- be read back at dispatch time to sign the outbound HMAC -- only ever
-- returned to the frontend as a boolean has_secret, never the value
-- itself (same pattern the vendored page's own comment describes).
CREATE TABLE webhook_targets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL,
  url              TEXT NOT NULL,
  event_filter     TEXT NOT NULL DEFAULT '*',
  secret           TEXT,
  active           BOOLEAN NOT NULL DEFAULT true,
  last_status      INTEGER,
  last_attempt_at  TIMESTAMPTZ,
  failure_count    INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX webhook_targets_active_idx ON webhook_targets (active) WHERE active = true;
