# IRONHORSE

Security-guard operations platform (client sites, guard shifts, patrols,
incidents, supervisors, optional camera integration). Currently
**pre-repo / planning-stage** — no application code exists yet. This repo
currently holds only documentation, assembled to carry a planning
conversation into a fresh session without losing context.

**Architectural precedent**: the design leans heavily on patterns already
proven in `dcentral-fieldops` (the Sod Boys Ltd field-operations system,
`https://github.com/RedjiJB/sodboys-fieldops.git`, local clone at
`C:\Users\jredj\dev\dcentral-fieldops`) — same domain-module style, same
capability-gating approach, same sovereignty-tiering discipline.

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
`docs/ROADMAP.md`'s blocker table for open questions that need resolving
first. Several features are explicitly marked **[gap]** throughout this doc
set — they were referenced in the original planning conversation without
their full design being captured, and need the user's input before they're
safe to design around.
