# IRONHORSE — Feature Specification

Consolidated feature list for the security-guard operations platform, organized
by area. Where a feature maps directly onto a proven `dcentral-fieldops`
pattern, that mapping is called out — see
[`PRECEDENT-ARCHITECTURE.md`](PRECEDENT-ARCHITECTURE.md) for the full detail
behind each reference.

Items marked **[gap]** were referenced in the original planning conversation
without their full design being captured — see
[`PROJECT-BRIEF.md`](PROJECT-BRIEF.md) §4 before designing around them.

---

## 1. Core domain

Mostly maps onto existing `dcentral-fieldops` concepts directly:

- Assignments (site + post + shift + guard + requirements) — maps to `jobs`/`shifts`
- Sites as the core object: client → site → posts → patrol routes → checkpoints → assets
- Guard/employee profile management (licence, certs, training, documents, availability)
- Scheduling/matching against licence, cert, site clearance, language, hours, proximity
- Immutable audit trail — same DID/verifiable-credential basis as the precedent system

## 2. Guard mobile app

- Shift start/end with GPS check-in/check-out + geofence verification
  (precedent: `resolveGeofenceVerified`, the confirm-before-execute timeclock flow)
- Guard tours/checkpoints — QR/NFC/GPS-verified patrol routes with exception
  reporting **[gap — see PROJECT-BRIEF §4.2]**
- Incident reporting (severity, category, photos, actions, status)
- Contact-supervisor button
- Duress/panic button — silent alarm, location-tagged, distinct from a normal
  incident **[gap — see PROJECT-BRIEF §4.1]**
- Lone-worker check-in timer (auto-alert if no activity in X minutes)
- Shift handoff notes (structured info for the next guard)
- Weapon/equipment issue log (checkout/return with signature confirmation —
  precedent: `checkouts.ts`'s structurally-impossible-double-checkout pattern)
- Multi-language incident input (original + auto-translated client-facing version)

## 3. Supervisor mobile app

Rides the same app/auth as the guard app, gated by `hasManagementCapability()`.

| Feature | Precedent basis |
|---|---|
| Live roster view — on duty, post, clocked-in status, last location | `listCrewWithLatestLocation()`, needs only a mobile-facing read |
| Approve/reject queue — timeclock corrections, shift extensions, escalations | `confirmations.ts` reused as-is; near-zero new backend |
| Remote incident escalation — bump severity or reassign before it reaches the client | new, on top of `incidents.ts` |
| Site visit / spot-check logging — supervisor's own geofenced check-in | `resolveGeofenceVerified`, distinct check-in type from a guard's shift check-in |
| Push-to-guard messaging / broadcast | `chat.ts` + `notifications.ts` — routing, not new infrastructure |
| Override/reassign shift on the fly (no-show handling) | `exceptions.ts`'s existing `delay` alert triggers it |
| Guard performance/compliance glance before last-minute assignment | ties into certification gating, §7 |
| Panic/duress alert receiver — acknowledge + dispatch, not just notify | depends on the panic-button design gap above |

**Implementation shape**: (1) a mobile-facing supervisor UI, (2) a handful of
new MCP tool endpoints that scope existing queries by "sites this supervisor
oversees," (3) wiring alerts/confirmations to route to the *correct*
supervisor, not just any management-role user.

## 4. Incident & alerting

- Incident management as a first-class object (severity, category, photos, actions, status)
- Emergency escalation tiers: LOW / MED / HIGH / CRITICAL — **human-in-the-loop,
  never autonomous** (matches the precedent's explicit AI-layer boundary, §11)
- Extend the existing exceptions-engine pattern: certification-gap checks,
  security-flavored idle/off-site thresholds

## 5. Camera integration module (optional, per-site)

Full design in [`DOMAIN-DESIGN.md`](DOMAIN-DESIGN.md) §4. Summary:

- Pluggable adapter, not a hard dependency — same pattern as `geofence_radius_m` being nullable on sites
- **ONVIF baseline**, vendor-specific adapters (Avigilon ACC API, HID) on top
- **Event-driven, not stream-driven** — motion/line-crossing/loitering events become `alerts.ts` rows
- **Snapshot, not stream, for evidence** — pulled via the camera's snapshot API, stored through `documents.ts`, linked to incidents
- **Checkpoint corroboration** — optional snapshot pull at a patrol-scan timestamp as a secondary verification layer on GPS
- **Requires a new `policy/sovereignty_tiers.yaml` entry**, decided per-vendor-adapter (on-prem NVR query vs. cloud VMS are different tier decisions)
- **Explicitly out of scope**: full VMS replacement, live video streaming into the app, facial-recognition matching (SAFR-style — its own future phase/decision if wanted)

## 6. Dispatcher/ops dashboard

- Live guard map + status counts + alert feed
- Coverage-gap forecasting (unassigned future shifts, X days out)
- Post risk scoring (incident/missed-checkpoint frequency by site)
- Weather-aware post adjustments — extends the same Open-Meteo integration
  pattern the precedent system already uses (`weather_forecast`, already
  `external_accepted` — likely reusable as-is if the query shape matches)

## 7. Compliance

- Compliance dashboard (% of licences/training/orientation current)
- Expiring-soon alerts (licences, certs, background checks)
- Certification gating — block/flag an assignment if a guard lacks a required
  site cert **[gap — see PROJECT-BRIEF §4.3]**
- Guard fatigue/hours tracking (weekly max, consecutive nights)

## 8. Client-facing

- Client portal: live coverage, daily activity, incident reports, coverage requests
- Client-verifiable shift proof — a signed credential per shift, same DID
  infrastructure basis as the precedent system
- Tamper-evident incident chain (hash-chained edits)

## 9. Reporting

- Daily activity reports
- Incident reports
- Patrol reports
- Missed-checkpoint reports
- Attendance / guard-hours reports
- Client-facing reports

## 10. Business layer

- Payroll integration: shift → verified hours → timesheet → payroll (precedent:
  `payroll.ts`'s reconciliation-only model — recompute fresh, never a stored
  pay run)
- Billing: contract → billable shifts → rate → invoice

## 11. AI layer (deliberately scoped)

- Query/summarize over operational data (e.g. "show me sites with staffing
  problems tonight") — precedent: `chat.ts`'s read-only tool registry pattern
- Draft incident summaries for human approval
- **Never given autonomous control over security decisions or escalation** —
  matches the precedent's own explicit boundary: "every mutating action still
  routes through confirm-before-execute regardless of which model produced it"

## 12. Architecture / process

New domain modules, following the exact `dcentral-fieldops` shape (module +
migration + MCP tool file + façade route where a browser needs it — see
`PRECEDENT-ARCHITECTURE.md` §6):

- `patrols.ts`
- `checkpoints.ts`
- `incidents.ts` (extends the `fieldReports.ts` pattern)
- `cameras.ts`

**Phased rollout** — see [`ROADMAP.md`](ROADMAP.md) for the concrete build
order this collapses into:

1. Ops MVP
2. Security-specific (patrols / incidents)
3. Business platform (billing / client portal)
4. Intelligence (AI, camera analytics)
