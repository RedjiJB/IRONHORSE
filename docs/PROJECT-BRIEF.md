# IRONHORSE — Project Brief

**Status**: pre-repo, planning stage. No code exists yet. This document captures a
planning conversation (originally held in a separate chat session, referencing
another codebase as an architectural template) so a fresh session can pick up
with full context.

**Source material**: this brief was assembled from a partial transcript — the
planning conversation that produced it is not fully available. Sections marked
**[gap]** reference decisions or ideas the transcript alludes to ("the earlier
brainstorm," "the certification-gating idea from before," "the patrol/checkpoint
module from earlier") without giving their full content. Treat those as things to
ask the user about before designing around them, not as settled specs.

---

## 1. What this is

A field-operations platform for a **security guard company** — sites, guards,
shifts, patrols/checkpoints, incident reporting, supervisor oversight, and
(optionally, per-site) camera-event integration. Client-facing reporting and
billing are in scope for a later phase.

## 2. Architectural precedent: reuse the dcentral-fieldops pattern

The plan explicitly designs around **reusing the domain architecture already
proven in `dcentral-fieldops`** (`C:\Users\jredj\dev\dcentral-fieldops`, the Sod
Boys Ltd landscaping field-ops system) rather than inventing a new one. Concrete
mappings called out in the planning conversation:

| dcentral-fieldops concept | IRONHORSE reuse |
|---|---|
| `crew_members.ts` role model (already has `foreman`, `management` roles) | "Supervisor" isn't a new concept — it's an existing role, gated by capability checks |
| `hasManagementCapability()`, `checkStandingCapability()` | Gate supervisor-only mobile features |
| `listCrewWithLatestLocation()` | Basis for the supervisor live-roster view — needs a mobile-facing read, not new backend |
| `confirmations.ts` (submit → review → approve/reject) | Reused as-is for supervisor approve/reject queue (timeclock corrections, shift extensions, incident escalations) — "almost no new backend, just a mobile UI on an existing table" |
| `resolveGeofenceVerified` | Reused for supervisor site-visit/spot-check geofenced check-ins, distinct from a guard's shift check-in |
| `chat.ts`, `notifications.ts` | Basis for push-to-guard messaging/broadcast — "routing, not new infrastructure" |
| `exceptions.ts` (already has a `delay` alert) | Basis for no-show handling / shift reassignment flow |
| `documents.ts` (already handles images, `job_id`/`site_id`/`tags` linking) | Storage for camera event snapshots — no new storage system needed |
| `alerts.ts` / notification pipeline | Camera motion/analytics events become `alerts.ts` rows, not a parallel pipeline |
| `policy/sovereignty_tiers.yaml` | Must gain a real entry for camera integration — "not a silent default" |
| DID / verifiable-credential audit trail (mentioned as "already stronger than proposed") | Basis for client-verifiable shift proof, tamper-evident incident chain |

**Before writing any IRONHORSE code**: read the actual current state of those
files in `dcentral-fieldops` — this brief describes them as of the planning
conversation, which may already be stale (see the memory-freshness caveat in any
saved memory about that repo).

## 3. Full feature list

Organized by area, consolidated from the planning conversation.

### 3.1 Core domain (mostly maps onto existing dcentral-fieldops concepts)

- Assignments (site + post + shift + guard + requirements) — maps to existing `jobs`/`shifts`-style concept
- Sites as core object: client → site → posts → patrol routes → checkpoints → assets
- Guard/employee profile management (licence, certs, training, documents, availability)
- Scheduling/matching against licence, cert, site clearance, language, hours, proximity
- Immutable audit trail (DID/verifiable-credential based, per the precedent system)

### 3.2 Guard mobile app

- Shift start/end with GPS check-in/check-out + geofence verification
- Guard tours/checkpoints — QR/NFC/GPS-verified patrol routes with exception reporting **[gap: "patrol/checkpoint module from earlier" — full design not in this transcript]**
- Incident reporting (severity, category, photos, actions, status)
- Contact-supervisor button
- Duress/panic button (silent alarm, location-tagged, distinct from a normal incident) **[gap: "panic button (from the earlier brainstorm)" — full design not in this transcript]**
- Lone-worker check-in timer (auto-alert if no activity in X minutes)
- Shift handoff notes (structured info for the next guard)
- Weapon/equipment issue log (checkout/return with signature confirmation)
- Multi-language incident input (original + auto-translated client-facing version)

### 3.3 Supervisor mobile app

Rides the same app/auth as the guard app, gated by `hasManagementCapability()`.

- **Live roster view** — who's on duty, at which post, clocked-in status, last-known location (basis: `listCrewWithLatestLocation()`, needs a mobile-facing read)
- **Approve/reject queue** — timeclock corrections, shift extensions, incident escalations (basis: `confirmations.ts`, near-zero new backend)
- **Remote incident escalation** — bump severity or reassign response before it reaches the client
- **Site visit / spot-check logging** — supervisor's own geofenced check-in at a site being inspected (basis: `resolveGeofenceVerified`), proves an actual visit vs. a remote approval
- **Push-to-guard messaging / broadcast** (basis: `chat.ts` + `notifications.ts`, routing only)
- **Override/reassign shift on the fly** — no-show handling: supervisor sees a `delay` alert (basis: `exceptions.ts`), picks a nearby/available replacement, reassigns from the phone
- **Guard performance/compliance glance** — licence/cert status at a glance before a last-minute assignment (ties into certification-gating, see 3.6)
- **Panic/duress alert receiver** — supervisors are first responders on a guard's panic button, can acknowledge and dispatch help (not just get notified)

Implementation shape: (1) a mobile-facing supervisor UI, (2) a couple of new MCP
tool endpoints that filter/scope existing queries by "sites this supervisor
oversees," (3) wiring alerts/confirmations to route to the *correct* supervisor,
not just any management-role user.

### 3.4 Incident & alerting

- Incident management as a first-class object (severity, category, photos, actions, status)
- Emergency escalation tiers: LOW / MED / HIGH / CRITICAL — **human-in-the-loop, never autonomous**
- Extend the existing exceptions engine: certification-gap checks, security-flavored idle/off-site thresholds

### 3.5 Camera integration module (optional, per-site)

Given the stated professional background (Avigilon, SAFR facial recognition),
this is deliberately scoped as a **pluggable adapter, not a hard dependency** —
same pattern as `geofence_radius_m` being nullable on sites in the precedent
system.

**Design:**

- New `src/domain/cameras.ts` — `cameras` table: `site_id`, `name`, `vendor`
  (avigilon / hikvision / generic-onvif), `stream_url_or_device_id`,
  `location_label` (e.g. "Main Gate", "Loading Dock"), `active`.
- **Protocol-agnostic core**: build against **ONVIF** as the baseline standard
  (most VMS/NVR systems, including Avigilon, support it). Vendor-specific
  integrations (Avigilon ACC API, HID access-control feeds) become adapters
  implementing a common interface — not the core.
- **Do not ingest or store raw video** — deliberate scope cut to avoid a storage
  and liability commitment. Instead:
  - **Event-driven, not stream-driven**: subscribe to motion/analytics events
    the camera/VMS already generates (motion-detected, line-crossing, loitering
    — pushed via webhook or ONVIF event subscription) and turn those into
    `alerts.ts` rows, reusing the existing alert/notification pipeline.
  - **Snapshot, not stream, for evidence**: on a triggered event (or a guard
    manually flagging "capture footage" from an incident report), pull a single
    still frame via the camera's snapshot API and store it through the existing
    `documents.ts` (already handles images + `job_id`/`site_id`/`tags` linking)
    — a snapshot attaches directly to an incident report, no new storage system.
- **Checkpoint corroboration**: if a guard scans a checkpoint near a camera,
  optionally pull a snapshot at that timestamp as a secondary verification layer
  on top of GPS.
- **Sovereignty tier entry required** — camera feeds are meaningfully more
  sensitive than a coordinate or a weather query. Likely:
  - `self_hosted_required` when pulling from an on-prem NVR/VMS the client
    already owns (no data leaves their network, this system only queries it)
  - `external_pending` when any cloud VMS (e.g. Avigilon Cloud) is in the path
  - This distinction must be made **explicit per-vendor-adapter**, not blanket.

**Explicitly out of scope for this module**: a full VMS replacement, live video
streaming into the app, or facial-recognition matching. If SAFR-style facial
recognition is wanted later, that's its own sovereignty-tier decision and
probably its own phase — flagged separately, not folded into this module.

### 3.6 Compliance

- Compliance dashboard (% of licences/training/orientation current)
- Expiring-soon alerts (licences, certs, background checks)
- **Certification gating** — block or flag an assignment if a guard lacks the
  required site cert **[gap: "certification-gating idea from before" — full
  design not in this transcript]**
- Guard fatigue/hours tracking (weekly max, consecutive nights)

### 3.7 Dispatcher/ops dashboard

- Live guard map + status counts + alert feed
- Coverage-gap forecasting (unassigned future shifts, X days out)
- Post risk scoring (incident/missed-checkpoint frequency by site)
- Weather-aware post adjustments (extends an existing Open-Meteo integration —
  same pattern dcentral-fieldops uses for its weather widget)

### 3.8 Client-facing

- Client portal: live coverage, daily activity, incident reports, coverage requests
- Client-verifiable shift proof — a signed credential per shift, leveraging the
  same DID infrastructure the precedent system already has
- Tamper-evident incident chain (hash-chained edits)

### 3.9 Reporting

- Daily activity reports
- Incident reports
- Patrol reports
- Missed-checkpoint reports
- Attendance / guard-hours reports
- Client-facing reports

### 3.10 Business layer

- Payroll integration: shift → verified hours → timesheet → payroll
- Billing: contract → billable shifts → rate → invoice

### 3.11 AI layer (deliberately scoped)

- Query/summarize over operational data (e.g. "show me sites with staffing problems tonight")
- Draft incident summaries for human approval
- **Never given autonomous control over security decisions or escalation**

### 3.12 Architecture / process

- New domain modules, following the existing `dcentral-fieldops` style:
  - `patrols.ts`
  - `checkpoints.ts`
  - `incidents.ts` (extends the `fieldReports.ts` pattern)
  - `cameras.ts`
- **Phased rollout** (as proposed):
  1. Ops MVP
  2. Security-specific (patrols / incidents)
  3. Business platform (billing / client portal)
  4. Intelligence (AI, camera analytics)

## 4. Open questions / gaps to resolve in the next session

These were referenced in the planning conversation but their full detail isn't
in this transcript. Ask the user before designing around them:

1. **Panic/duress button** — "the earlier brainstorm" is referenced but not
   captured here. Need: trigger UX (how does a guard silently activate it?),
   what exactly gets sent, who else besides the supervisor gets alerted.
2. **Patrol/checkpoint module** — referenced ("QR/NFC/GPS-verified patrol
   routes") but the actual checkpoint data model, route definition, and
   exception-reporting flow aren't detailed here.
3. **Certification-gating** — referenced twice but the actual rule model
   (which certs gate which site/post types, how "required site cert" is
   defined and attached to a site) isn't detailed here.
4. **Repo relationship to dcentral-fieldops** — is IRONHORSE a fresh repo that
   imports/copies patterns, a fork, or a shared-package extraction? Not decided
   in the transcript. (User has now confirmed: new, empty repo named
   `IRONHORSE`, no code yet.)
5. **Next immediate ask from the prior conversation**: "Want this turned into
   an actual prioritized build order against your repo (what's a migration,
   what's a new domain module, what's UI-only)?" — this was offered but not
   yet done. Also offered and not yet done: draft the actual `cameras.ts`
   module + migration + a proposed `sovereignty_tiers.yaml` entry.

## 5. Suggested next steps

Pick up with either:

- **Prioritized build order** — turn §3 into a phased backlog against a real
  repo structure (migrations vs. new domain modules vs. UI-only work), once
  the open questions in §4 are resolved.
- **Draft `cameras.ts`** — the module, its migration, and a proposed
  `sovereignty_tiers.yaml` entry, following the exact style of
  `dcentral-fieldops/src/domain/*.ts` — this was the last concrete offer made
  in the planning conversation and doesn't depend on the open questions above.
