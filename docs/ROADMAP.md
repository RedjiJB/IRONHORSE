# IRONHORSE — Roadmap

Phased build order. Each phase is scoped to ship something real and usable on
its own, matching the precedent system's own discipline of never leaving a
built UI calling an unbuilt endpoint (see
[`PRECEDENT-ARCHITECTURE.md`](PRECEDENT-ARCHITECTURE.md) §7) — a phase isn't
"done" until every surface it exposes actually has something real behind it.

This is a first-pass sequencing, not a committed schedule — validate scope and
order with the user, especially anywhere a **[gap]** item from
[`DOMAIN-DESIGN.md`](DOMAIN-DESIGN.md) blocks a phase below.

---

## Phase 0 — Repo bootstrap (done, 2026-09-04)

- [x] Repo relationship to `dcentral-fieldops`: **git-level fork**, both
      histories preserved (`bootstrap/fork-precedent`, merged to `main` in
      [RedjiJB/IRONHORSE#1](https://github.com/RedjiJB/IRONHORSE/pull/1)),
      then pruned — all `src/domain/*.ts` (landscaping business logic), their
      facade routes/MCP tools/migrations/tests, and Sod-Boys operational
      files (`.claude/`, demo files, `ops/`, `docker-compose.yml`) removed.
- [x] Identity/capability stack: same D-Central stack as-is (`did:web`,
      hand-rolled JWT-VCs, capability tiers) — not re-litigated, per
      `PRECEDENT-ARCHITECTURE.md` §2's own hard-won lesson.
- [x] Base project shape stood up: `src/identity/`, `src/db/migrations/`
      (identity-only, 0001-0005), `src/mcp/tools/` (identity tool + shared
      helpers), `src/facade/` (skeleton, no domain routes yet),
      `policy/sovereignty_tiers.yaml`. `src/domain/` is currently empty —
      IRONHORSE's own modules land starting Phase 1.
- [x] Frontend approach: **vendored OpenConstructionERP fork** kept
      (`vendor/openconstructionerp` submodule), AGPL-3.0 obligation
      explicitly accepted for IRONHORSE (not assumed from the precedent's
      acceptance). Still open before real UI work: the submodule points at
      the `sod-boys-fork` branch and needs its own IRONHORSE-specific
      fork/rebrand.
- [x] Verified: `npm install`, `npm run build`, `npm run migrate` (against a
      throwaway local Postgres), and `npm test` (15/15 identity-layer tests)
      all pass on the pruned tree.

## Phase 1 — Ops MVP (done, 2026-09-05)

The minimum real system: sites, guards, shifts, and the supervisor's ability
to see and approve what's happening. No security-specific features yet.

- [x] Core domain: `sites.ts`, `guards.ts`, `shifts.ts`, `confirmations.ts`,
      `timeclock.ts` — adapted (not copied) from the precedent's
      `sites.ts`/`crewMembers.ts`/`shifts.ts` patterns per
      `PRECEDENT-ARCHITECTURE.md` §6, plus migrations 0006-0010
      ([RedjiJB/IRONHORSE#2](https://github.com/RedjiJB/IRONHORSE/pull/2)).
      Guards get a real `did:web` identity from registration onward (not a
      later-migration backfill, since IRONHORSE inherited the full identity
      stack in Phase 0).
- [x] Guard shift check-in/out: `resolveGeofenceVerified` +
      confirm-before-execute timeclock flow, same as the precedent —
      verified end-to-end (submit → supervisor approval → geofence
      re-verified fresh at approval time), part of PR #2 above.
- [x] Supervisor live-roster view + approve/reject queue, exposed over the
      REST façade with a minimal purpose-built HTML/JS page (not yet the
      vendored OpenConstructionERP frontend — that integration is still
      separate, unstarted work)
      ([RedjiJB/IRONHORSE#3](https://github.com/RedjiJB/IRONHORSE/pull/3)).
      Found and fixed a real bug here: the confirmation-executor registry
      is in-memory per process, so the façade server needs its own
      executor registration independent of the MCP server's.
- [x] Push-to-guard messaging/broadcast: a new `messages.ts` module (not
      adapted from the precedent — neither `notifications.ts` nor the
      read-only `chat.ts` model person-to-person messaging), one row per
      recipient for independent read state, broadcast scoped to guards
      actually on duty at a site right now
      ([RedjiJB/IRONHORSE#4](https://github.com/RedjiJB/IRONHORSE/pull/4)).
- [x] Compliance dashboard basics: `guard_certifications` +
      expiring-soon/expired queries, visibility only — no gating logic yet.
      DOMAIN-DESIGN.md §5's resolved cert-gating design (per-post required
      certs) needs a posts concept this domain doesn't have, so enforcement
      is Phase 2 scope once patrols/posts land
      ([RedjiJB/IRONHORSE#5](https://github.com/RedjiJB/IRONHORSE/pull/5)).

Every PR above was verified end-to-end against a live Postgres (not just
`npm run build`/`npm test`) before merging — real data through the actual
submit/approve/broadcast/compliance flows, matching
`PRECEDENT-ARCHITECTURE.md` §7's discipline of never leaving a built
surface calling something unverified.

## Phase 2 — Security-specific

The features that make this a *security* platform, not a generic field-ops
clone.

- [ ] Incident reporting (`incidents.ts`, per `DOMAIN-DESIGN.md` §2)
- [ ] Contact-supervisor button, remote incident escalation
- [ ] Duress/panic button — design resolved (`DOMAIN-DESIGN.md` §3:
      hardware trigger, location-only payload, subtle UI feedback, pages
      every supervisor on-site); the hardware-trigger requirement means this
      needs the guard app's native shell in place before it can ship, not
      just backend work
- [ ] Patrols/checkpoints — design resolved (`DOMAIN-DESIGN.md` §1:
      `patrol_runs.shift_id` required)
- [ ] Certification gating — design resolved (`DOMAIN-DESIGN.md` §5:
      per-post required certs, soft flag on assignment)
- [ ] Weapon/equipment issue log (direct reuse of `checkouts.ts`'s
      structurally-impossible-double-checkout pattern)
- [ ] Shift handoff notes
- [ ] Lone-worker check-in timer
- [ ] Site visit / spot-check logging (supervisor's own geofenced check-in)
- [ ] Override/reassign shift on the fly (no-show handling)
- [ ] Multi-language incident input

## Phase 3 — Business platform

- [ ] Client portal (live coverage, daily activity, incident reports, coverage requests)
- [ ] Client-verifiable shift proof (signed credential per shift)
- [ ] Tamper-evident incident chain (the hash-chained `incident_actions` design
      from `DOMAIN-DESIGN.md` §2)
- [ ] Reporting suite: daily activity, incident, patrol, missed-checkpoint,
      attendance/guard-hours, client-facing reports
- [ ] Payroll integration (direct reuse of `payroll.ts`'s reconciliation-only model)
- [ ] Billing: contract → billable shifts → rate → invoice

## Phase 4 — Intelligence

- [ ] Camera integration module (`cameras.ts`, per `DOMAIN-DESIGN.md` §4) —
      sovereignty-tier entries resolved (`policy/sovereignty_tiers.yaml`:
      `camera_events_onvif`, `camera_events_avigilon_acc_onprem` both
      `self_hosted_required`; `camera_events_avigilon_cloud` stays
      `external_pending` until a real client on that product path exists) —
      module itself (table, migration, ONVIF adapter, MCP tools) is
      unbuilt
- [ ] Coverage-gap forecasting
- [ ] Post risk scoring
- [ ] Weather-aware post adjustments
- [ ] AI query/summarize layer over operational data (`chat.ts`-pattern reuse)
- [ ] AI-drafted incident summaries for human approval

**Explicitly deferred past Phase 4, not scoped at all**: full VMS replacement,
live video streaming, facial-recognition matching. If SAFR-style facial
recognition is wanted eventually, it needs its own sovereignty-tier decision
and its own phase — never silently folded into the Phase 4 camera work.

---

## What blocks what — quick reference

All design-question and sovereignty-tier blockers below are resolved as of
2026-09-04 (see `PROJECT-BRIEF.md` §3 and `DOMAIN-DESIGN.md`) —
**implementation may proceed on everything in this table.**

| Item | Status |
|---|---|
| Duress/panic button implementation | Design resolved — still needs the guard app's native shell for the hardware trigger |
| Patrols/checkpoints implementation | Design resolved |
| Certification gating | Design resolved |
| Camera module going to production (on-prem ONVIF / Avigilon ACC) | Design + sovereignty tier both resolved (`self_hosted_required`) — clear to build |
| Camera module going to production (Avigilon Cloud/Alta path) | **Still blocked** — `external_pending` until a real client on that product path exists and its data-handling terms get reviewed; do not let a client's cloud-Avigilon deployment depend on this in production before that review happens |
| Any code at all | Phase 0 done — unblocked |

Don't guess and build ahead of an unresolved design question, per the same
discipline `PRECEDENT-ARCHITECTURE.md` documents throughout (every real gap
in that system was named explicitly rather than silently papered over) — the
one item left that still needs this treatment is the cloud-Avigilon path
specifically, not the camera module as a whole.
