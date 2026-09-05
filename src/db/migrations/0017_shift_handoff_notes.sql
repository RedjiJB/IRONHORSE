-- Shift handoff notes (FEATURES.md §2: "structured info for the next
-- guard"). No dcentral-fieldops equivalent to adapt -- landscaping crews
-- have no post-to-post handoff concept. Site-scoped, not shift-to-shift:
-- this system has no successor/predecessor pointer between shifts
-- (shifts.ts), so a note is left against the site and picked up by
-- whichever guard is next on duty there -- the same "who's actually
-- there" reasoning messages.ts's broadcastToSite already applies instead
-- of a fixed roster relationship.
CREATE TABLE shift_handoff_notes (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id                  UUID NOT NULL REFERENCES sites(id),
  from_shift_id            UUID NOT NULL REFERENCES shifts(id),
  author_guard_id          UUID NOT NULL REFERENCES guards(id),
  category                 TEXT NOT NULL, -- 'general' | 'equipment' | 'access_control' | 'incident_followup' | 'visitor' -- app-enforced, not a DB enum, same convention as guards.role/equipment.category
  body                     TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_by_guard_id UUID REFERENCES guards(id), -- first guard on the next shift to read it; nullable while unread
  acknowledged_at          TIMESTAMPTZ
);

CREATE INDEX shift_handoff_notes_site_id_idx ON shift_handoff_notes (site_id, created_at DESC);
CREATE INDEX shift_handoff_notes_unacknowledged_idx ON shift_handoff_notes (site_id) WHERE acknowledged_at IS NULL;
