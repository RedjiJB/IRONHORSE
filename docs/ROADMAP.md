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

## Phase 0 — Repo bootstrap (not started)

Before any domain code:

- [ ] Decide the repo relationship to `dcentral-fieldops`: fresh repo copying
      patterns by hand, or something more structural (shared package, fork).
      `PROJECT-BRIEF.md` §4.4 flags this as unresolved — the user has since
      confirmed IRONHORSE is a fresh, empty repo, but *how much* gets copied
      vs. rebuilt is still open.
- [ ] Decide whether IRONHORSE reuses the same D-Central identity/capability
      stack (`did:web`, JWT-VCs, capability tiers) as-is, or a simplified
      version of it. Given the precedent's own hard-won lesson (Veramo tried
      and reversed, 171→89 dependencies), **don't re-litigate the DID/VC
      library choice** — inherit `PRECEDENT-ARCHITECTURE.md` §2's decisions
      directly unless there's a specific reason IRONHORSE's needs differ.
- [ ] Stand up the same base project shape: `src/identity/`, `src/domain/`,
      `src/db/migrations/`, `src/mcp/tools/`, `policy/sovereignty_tiers.yaml`.
- [ ] Decide the frontend approach — reuse the same vendored
      OpenConstructionERP fork (inherits its AGPL-3.0 obligations, see
      `PRECEDENT-ARCHITECTURE.md` §7), a fresh vendored frontend, or a
      purpose-built mobile app given the guard/supervisor apps are the primary
      surface (unlike the precedent system, which is dashboard-first).
      **This decision matters more for IRONHORSE than it did for the
      precedent system** — a security-guard operation is field/mobile-first,
      not office-dashboard-first, so the OpenConstructionERP fork's
      dashboard-shaped assumptions may fit worse here than they did for Sod
      Boys.

## Phase 1 — Ops MVP

The minimum real system: sites, guards, shifts, and the supervisor's ability
to see and approve what's happening. No security-specific features yet.

- [ ] Core domain: sites, guard/crew profiles, shifts/assignments (direct
      reuse of the precedent's `sites.ts`/`crewMembers.ts`/`shifts.ts`
      patterns — see `PRECEDENT-ARCHITECTURE.md` §6)
- [ ] Guard app: shift start/end with GPS check-in/check-out + geofence
      verification (direct reuse of `resolveGeofenceVerified` +
      confirm-before-execute timeclock flow)
- [ ] Supervisor app: live roster view, approve/reject queue (both are
      near-zero-new-backend per `FEATURES.md` §3 — this is the highest
      leverage phase-1 work)
- [ ] Push-to-guard messaging/broadcast (reuses `chat.ts`/`notifications.ts`
      routing)
- [ ] Compliance dashboard basics: expiring-soon alerts for licences/certs
      (no gating logic yet — that's Phase 2, blocked on the `[gap]` in
      `DOMAIN-DESIGN.md` §5)

## Phase 2 — Security-specific

The features that make this a *security* platform, not a generic field-ops
clone.

- [ ] Incident reporting (`incidents.ts`, per `DOMAIN-DESIGN.md` §2)
- [ ] Contact-supervisor button, remote incident escalation
- [ ] Duress/panic button — **blocked on resolving the open questions in
      `DOMAIN-DESIGN.md` §3** before implementation starts
- [ ] Patrols/checkpoints — **blocked on resolving the open question in
      `DOMAIN-DESIGN.md` §1** (pre-scheduled vs. ad hoc)
- [ ] Certification gating — **blocked on resolving the open questions in
      `DOMAIN-DESIGN.md` §5**
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
      **requires a `policy/sovereignty_tiers.yaml` entry before it ships**,
      decided per vendor adapter
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

| Blocked item | Blocked on |
|---|---|
| Duress/panic button implementation | Resolving trigger UX + payload questions in `DOMAIN-DESIGN.md` §3 |
| Patrols/checkpoints implementation | Resolving pre-scheduled-vs-ad-hoc question in `DOMAIN-DESIGN.md` §1 |
| Certification gating | Resolving rule-model questions in `DOMAIN-DESIGN.md` §5 |
| Camera module going to production | A real, dated `sovereignty_tiers.yaml` entry per vendor adapter |
| Any code at all | Phase 0's repo/frontend/identity-stack decisions |

Resolve the left column with the user before starting the corresponding
right-hand work — don't guess and build ahead of an unresolved design
question, per the same discipline `PRECEDENT-ARCHITECTURE.md` documents
throughout (every real gap in that system was named explicitly rather than
silently papered over).
