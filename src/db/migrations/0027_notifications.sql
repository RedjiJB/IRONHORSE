-- Re-expressed from v1's `notifications` table -- requirements baseline,
-- not copied code. A single event log, not a per-recipient delivery
-- table -- one row's delivered_at/acknowledged_by covers the whole
-- recipient group ("management as a unit" semantics), same real
-- limitation v1 documents and explicitly defers (a true
-- notification_deliveries table would be needed for per-recipient
-- tracking). Delivery itself (WhatsApp via a host-side poller) is Phase 3
-- (OpenClaw wiring) scope -- what's built here is the mechanism a poller
-- would call: pending/escalation-candidate queries and the state
-- transitions, not the poller process itself.
CREATE TYPE notification_priority AS ENUM ('critical', 'routine');

CREATE TABLE notifications (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  priority                  notification_priority NOT NULL,
  message                   TEXT NOT NULL,
  source_type               TEXT NOT NULL, -- 'alert' | 'asset' | 'order' | 'safety_report' -- app-enforced, not a DB enum, same as v1
  source_id                 UUID, -- polymorphic, same pattern as alerts.related_record_id
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at              TIMESTAMPTZ, -- meaningful only for 'critical'; stays NULL forever for 'routine'
  acknowledged_at           TIMESTAMPTZ,
  acknowledged_by           UUID REFERENCES crew_members(id),
  whatsapp_message_id       TEXT, -- captured at delivery for reply-correlation (Phase 3 concern)
  escalated_count           INTEGER NOT NULL DEFAULT 0,
  last_escalated_at         TIMESTAMPTZ,
  send_attempts             INTEGER NOT NULL DEFAULT 0, -- caps undelivered retries, separate from escalation
  recipient_roles_override  TEXT[] -- NULL = use critical_notification_roles; else routes to these roles instead
);

CREATE INDEX notifications_pending_idx ON notifications (priority, delivered_at) WHERE delivered_at IS NULL;
CREATE INDEX notifications_escalation_idx ON notifications (priority, delivered_at, acknowledged_at) WHERE acknowledged_at IS NULL;
