# IRONHORSE

Security-guard operations platform (client sites, guard shifts, patrols,
incidents, supervisors, optional camera integration). **Phase 0 (repo
bootstrap) and Phase 1 (Ops MVP) are both done** — see
[`docs/ROADMAP.md`](docs/ROADMAP.md). Sites, guards, shifts,
confirm-before-execute timeclock, the supervisor live-roster/approve-reject
UI, push-to-guard messaging/broadcast, and compliance-dashboard basics are
all live on `main`, each verified end-to-end against a real Postgres before
merging. Next up is Phase 2 (patrols, incidents, duress, cert-gating
enforcement) — see `docs/ROADMAP.md`'s blocker table.

**Architectural precedent**: forked at the git level from `dcentral-fieldops`
(the Sod Boys Ltd field-operations system,
`https://github.com/RedjiJB/sodboys-fieldops.git`, local clone at
`C:\Users\jredj\dev\dcentral-fieldops`) — same domain-module style, same
capability-gating approach, same sovereignty-tiering discipline. See
[`docs/ROADMAP.md`](docs/ROADMAP.md) Phase 0 for exactly what was kept vs.
pruned.

## Documentation

Read in this order for full context, or jump straight to whichever document
answers your current question:

1. [`docs/PROJECT-BRIEF.md`](docs/PROJECT-BRIEF.md) — start here. What this
   project is, the precedent-mapping summary, and the open design questions
   that need the user's input before certain features can be built.
2. [`docs/PRECEDENT-ARCHITECTURE.md`](docs/PRECEDENT-ARCHITECTURE.md) — a
   deep, source-verified read of `dcentral-fieldops`'s real architecture:
   identity/capability model, the confirm-before-execute pattern, sovereignty
   tiering, the domain module inventory, and hard production lessons worth
   inheriting directly.
3. [`docs/FEATURES.md`](docs/FEATURES.md) — the full feature specification,
   organized by area, cross-referenced against the precedent patterns each
   feature reuses.
4. [`docs/DOMAIN-DESIGN.md`](docs/DOMAIN-DESIGN.md) — concrete schema
   sketches for the four new domain modules IRONHORSE needs
   (`patrols.ts`/`checkpoints.ts`, `incidents.ts`, duress alerts, `cameras.ts`),
   each following the precedent system's exact module conventions.
5. [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased build order (Ops MVP →
   security-specific → business platform → intelligence), with a table
   showing exactly which open design question blocks which phase of work.

## Before writing any code here

Read `docs/PRECEDENT-ARCHITECTURE.md` in full, then the relevant section of
`docs/DOMAIN-DESIGN.md` for whatever module you're about to build, and check
`docs/ROADMAP.md`'s blocker table for anything still open. All three
originally-**[gap]** design questions (duress button, patrol scheduling,
certification gating) were resolved 2026-09-04 — see `docs/PROJECT-BRIEF.md`
§3. The one remaining real blocker is the camera module's
`policy/sovereignty_tiers.yaml` entry, needed per vendor adapter before that
module ships.
