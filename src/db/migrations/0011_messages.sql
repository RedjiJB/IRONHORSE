-- Push-to-guard messaging/broadcast (FEATURES.md §3). Not modeled on
-- dcentral-fieldops's notifications.ts (a single shared-row-per-group
-- event log for alert-sourced pages, see PRECEDENT-ARCHITECTURE.md §6) --
-- this is direct person-to-person and broadcast messaging, a genuinely
-- different shape neither notifications.ts nor the read-only chat.ts
-- assistant models. One row per recipient (a broadcast fans out to N rows
-- at send time), not a shared row with array-of-recipients semantics --
-- gives each guard their own real read_at state, not "read by the group."
CREATE TABLE messages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id     UUID NOT NULL REFERENCES guards(id),
  recipient_id  UUID NOT NULL REFERENCES guards(id),
  site_id       UUID REFERENCES sites(id), -- set when this came from a site broadcast, NULL for a direct message
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at       TIMESTAMPTZ
);

CREATE INDEX messages_recipient_id_idx ON messages (recipient_id, created_at DESC);
