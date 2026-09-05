-- Compliance-dashboard basics (FEATURES.md §7: "expiring-soon alerts
-- (licences, certs, background checks)"). No gating logic yet -- that's
-- Phase 2 (DOMAIN-DESIGN.md §5's resolved cert-gating design attaches
-- required certs per-post, which needs a posts concept this domain
-- doesn't have yet). This table only tracks what certifications a guard
-- actually holds and when they expire; nothing here blocks or flags an
-- assignment yet.
CREATE TABLE guard_certifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guard_id     UUID NOT NULL REFERENCES guards(id),
  cert_type    TEXT NOT NULL, -- e.g. 'armed_guard_license', 'first_aid', 'background_check' -- app-enforced, not a DB enum, same convention as guards.role
  issued_at    DATE,
  expires_at   DATE NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX guard_certifications_guard_id_idx ON guard_certifications (guard_id);
CREATE INDEX guard_certifications_expires_at_idx ON guard_certifications (expires_at);
