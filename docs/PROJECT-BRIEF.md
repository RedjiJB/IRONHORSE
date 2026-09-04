# IRONHORSE — Project Brief

**Status**: pre-repo, planning stage. No code exists yet. This document
captures a planning conversation (originally held in a separate chat session,
referencing another codebase as an architectural template) so a fresh session
can pick up with full context. It's the entry point into a small doc set — see
§5 for the full map.

**Source material**: this brief was assembled from a partial transcript — the
planning conversation that produced it is not fully available. Sections marked
**[gap]** reference decisions or ideas the transcript alludes to ("the earlier
brainstorm," "the certification-gating idea from before," "the patrol/checkpoint
module from earlier") without giving their full content. Treat those as things
to ask the user about before designing around them, not as settled specs.

---

## 1. What this is

A field-operations platform for a **security guard company** — sites, guards,
shifts, patrols/checkpoints, incident reporting, supervisor oversight, and
(optionally, per-site) camera-event integration. Client-facing reporting and
billing are in scope for a later phase. Full feature breakdown:
[`FEATURES.md`](FEATURES.md).

## 2. Architectural precedent: reuse the dcentral-fieldops pattern

The plan explicitly designs around **reusing the domain architecture already
proven in `dcentral-fieldops`**
(`https://github.com/RedjiJB/sodboys-fieldops.git`, local clone at
`C:\Users\jredj\dev\dcentral-fieldops`, the Sod Boys Ltd landscaping field-ops
system) rather than inventing a new one.

A full, source-verified read of that system's identity model, capability
tiers, confirm-before-execute pattern, sovereignty-tiering discipline, domain
module inventory, and hard-won production lessons now lives in
[`PRECEDENT-ARCHITECTURE.md`](PRECEDENT-ARCHITECTURE.md) — read that document
before writing any IRONHORSE code. It was verified directly against the real
repo on 2026-09-04; re-check anything you're relying on against the live repo
before treating it as current, since `dcentral-fieldops` is actively
developed and this snapshot will drift.

The short version, as a lookup table (see `PRECEDENT-ARCHITECTURE.md` for the
reasoning behind each row):

| dcentral-fieldops concept | IRONHORSE reuse |
|---|---|
| `crew_members.ts` role model (`foreman`, `management` roles) | "Supervisor" isn't a new concept — an existing role, gated by capability checks |
| `hasManagementCapability()`, `checkStandingCapability()` | Gate supervisor-only mobile features |
| `listCrewWithLatestLocation()` | Basis for the supervisor live-roster view |
| `confirmations.ts` (submit → review → approve/reject) | Reused as-is for the supervisor approve/reject queue |
| `resolveGeofenceVerified` | Reused for supervisor site-visit/spot-check geofenced check-ins |
| `chat.ts`, `notifications.ts` | Basis for push-to-guard messaging/broadcast |
| `exceptions.ts` (`delay` alert) | Basis for no-show handling / shift reassignment |
| `documents.ts` | Storage for camera event snapshots and incident media |
| `alerts.ts` / notification pipeline | Camera motion/analytics events become `alerts.ts` rows |
| `policy/sovereignty_tiers.yaml` | Must gain a real, dated entry for camera integration |
| DID / verifiable-credential audit trail | Basis for client-verifiable shift proof, tamper-evident incident chain |

## 3. Open questions / gaps to resolve

These were referenced in the planning conversation but their full detail isn't
in the available transcript. Each is also flagged inline in
[`DOMAIN-DESIGN.md`](DOMAIN-DESIGN.md) at the point it blocks a concrete design
decision — resolve with the user before designing further around any of them:

1. **Panic/duress button** — trigger UX (how does a guard silently activate
   it?), exact payload sent, who besides the supervisor gets alerted.
2. **Patrol/checkpoint module** — the actual checkpoint data model, route
   definition, and exception-reporting flow; specifically whether a patrol
   run must be tied to a scheduled shift or can start ad hoc.
3. **Certification-gating** — which certs gate which site/post types, how a
   "required site cert" is defined and attached to a site, and whether a
   missing cert is a hard block or a soft flag.
4. ~~**Repo relationship to dcentral-fieldops**~~ — **resolved**: fresh, empty
   repo named `IRONHORSE`, no code yet. Still open: how much of the identity/
   capability stack and frontend approach gets inherited vs. rebuilt — see
   [`ROADMAP.md`](ROADMAP.md) Phase 0.

## 4. What's already been done with this brief

The two concrete offers made at the end of the original planning conversation
are now both done:

- **Prioritized build order** — [`ROADMAP.md`](ROADMAP.md), phased against
  what's a migration, a new domain module, or UI-only, with a blocker table
  cross-referencing the open questions in §3 above.
- **`cameras.ts` design** (module shape + sovereignty-tier requirement, not
  yet actual code/migration) — [`DOMAIN-DESIGN.md`](DOMAIN-DESIGN.md) §4,
  alongside first-pass sketches for the three other new modules
  (`patrols.ts`/`checkpoints.ts`, `incidents.ts`, duress alerts).

## 5. Document map

- [`README.md`](../README.md) — repo entry point
- **`PROJECT-BRIEF.md`** (this document) — overview, precedent summary, open questions
- [`PRECEDENT-ARCHITECTURE.md`](PRECEDENT-ARCHITECTURE.md) — deep, source-verified read of `dcentral-fieldops`'s real architecture
- [`FEATURES.md`](FEATURES.md) — full feature specification by area
- [`DOMAIN-DESIGN.md`](DOMAIN-DESIGN.md) — concrete schema sketches for the four new domain modules
- [`ROADMAP.md`](ROADMAP.md) — phased build order with a blocker cross-reference table

Read them in that order for full context; jump straight to `ROADMAP.md` if you
just need to know what to build next.
