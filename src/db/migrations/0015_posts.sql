-- Certification-gating basics (DOMAIN-DESIGN.md §5, resolved 2026-09-04:
-- per-post granular, soft flag). A post is a specific position within a
-- site (e.g. "Main Gate -- Armed" vs "Lobby Desk -- Unarmed" at the same
-- site), distinct from the site itself -- required certs attach here, not
-- to sites.
CREATE TABLE posts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id    UUID NOT NULL REFERENCES sites(id),
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX posts_site_id_idx ON posts (site_id);

-- One row per (post, required cert type) -- a post with no rows here has
-- no requirements. cert_type is open TEXT, matching
-- guard_certifications.cert_type's own convention, not a DB enum shared
-- between the two tables (a typo'd cert_type here just means a
-- requirement nothing will ever satisfy, an app-level bug to catch, not a
-- DB constraint problem).
CREATE TABLE post_required_certifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    UUID NOT NULL REFERENCES posts(id),
  cert_type  TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX post_required_certifications_post_id_idx ON post_required_certifications (post_id);

-- Nullable: a shift assigned before posts exist at a site, or at a site
-- that never adopts posts, works exactly as it did before this migration.
-- Gating only activates once a shift is actually tied to a post -- every
-- existing shift row gets post_id = NULL for free, no backfill needed.
ALTER TABLE shifts ADD COLUMN post_id UUID REFERENCES posts(id);
