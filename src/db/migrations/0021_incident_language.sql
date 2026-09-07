-- Multi-language incident input (FEATURES.md §2: "original + auto-
-- translated client-facing version"). Resolved scope: no auto-translate
-- wired up here -- that needs either an external translation API (its
-- own sovereignty-tier decision, same category as the still-blocked
-- Avigilon Cloud camera path) or a self-hosted translation service that
-- doesn't exist in this environment yet. This migration ships the data
-- model only: the language a guard actually wrote the summary in, and a
-- nullable translated_summary a supervisor fills in by hand later.
--
-- translated_summary is a direct-mutation field, not routed through
-- incident_actions -- same reasoning incidents.ts's own header gives for
-- why 'escalated'/'resolved' update incidents.status directly while only
-- severity gets the append-only treatment: a translation isn't the kind
-- of decision that needs a tamper-evident history of who-said-what-when.
ALTER TABLE incidents ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
ALTER TABLE incidents ADD COLUMN translated_summary TEXT;
ALTER TABLE incidents ADD COLUMN translated_by_guard_id UUID REFERENCES guards(id);
ALTER TABLE incidents ADD COLUMN translated_at TIMESTAMPTZ;
