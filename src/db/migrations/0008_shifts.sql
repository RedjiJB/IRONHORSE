-- Re-expressed from dcentral-fieldops's `shifts` table (see
-- PRECEDENT-ARCHITECTURE.md §6). No job_id -- that FK exists in the
-- precedent because landscaping work is organized around jobs; IRONHORSE's
-- assignment unit is site + guard + shift, with no equivalent concept yet
-- (a "post" -- see DOMAIN-DESIGN.md §5's certification-gating decision --
-- is Phase 2 scope, layered on top of shifts then, not needed for Phase 1's
-- Ops MVP).
CREATE TYPE shift_status AS ENUM ('assigned', 'confirmed', 'declined', 'no_show');

CREATE TABLE shifts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  guard_id         UUID NOT NULL REFERENCES guards(id),
  site_id          UUID NOT NULL REFERENCES sites(id),
  date             DATE NOT NULL,
  start_time       TIME,
  end_time         TIME,
  status           shift_status NOT NULL DEFAULT 'assigned',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX shifts_guard_id_date_idx ON shifts (guard_id, date);
CREATE INDEX shifts_site_id_date_idx ON shifts (site_id, date);
