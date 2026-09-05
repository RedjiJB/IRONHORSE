# IRONHORSE — Domain Design

Concrete sketches for the four new domain modules identified in
[`FEATURES.md`](FEATURES.md) §12, following the exact conventions documented in
[`PRECEDENT-ARCHITECTURE.md`](PRECEDENT-ARCHITECTURE.md). **These are sketches
to start a real design conversation from, not final schemas** — validate each
against the actual current state of `dcentral-fieldops/src/domain/` before
writing migrations, since that repo is still actively changing.

Every module below follows the same four-part shape the precedent system uses:
a domain module (`src/domain/*.ts`), a numbered migration
(`src/db/migrations/00NN_*.sql`), an MCP tool file (`src/mcp/tools/*.ts`), and
— only where a browser needs to reach it — a REST façade route.

---

## 1. `patrols.ts` + `checkpoints.ts`

**Status: resolved (2026-09-04)**. Originally referenced as "the
patrol/checkpoint module from earlier" without a captured design; the open
scheduling question below has now been answered by the user.

**Decision — patrol runs require a shift**: `patrol_runs.shift_id` is a
**required, non-nullable FK**, not optional. A guard can only start a patrol
route while clocked into a shift at that site. Reasoning: keeps patrol
activity accountable to a specific assignment, and anchors missed-checkpoint
exception logic (route pace expectations) to a real shift window instead of
needing a fallback for standalone runs. A supervisor's own spot-check
patrol is a distinct check-in type (`FEATURES.md` §3's "site visit /
spot-check logging"), not a `patrol_run` — it doesn't need this FK.

**Proposed shape**:

- `patrol_routes` — `id`, `site_id`, `name`, `active`. A named, reusable route
  definition per site (e.g. "Perimeter — night shift").
- `checkpoints` — `id`, `patrol_route_id`, `sequence`, `label`, `verification_method`
  (`qr` | `nfc` | `gps`), `qr_or_nfc_token` (nullable — only for those methods),
  `lat`/`lng`/`radius_m` (nullable — only for `gps`).
- `patrol_runs` — `id`, `patrol_route_id`, `guard_crew_member_id`, `shift_id`
  (required FK — see decision above), `started_at`, `completed_at`
  (nullable), `status` (`in_progress` | `completed` | `abandoned`).
- `checkpoint_scans` — `id`, `patrol_run_id`, `checkpoint_id`, `scanned_at`,
  `verified` (bool — did the QR/NFC/GPS check actually pass), `exception_note`
  (nullable — a guard's free-text note when a checkpoint was skipped or an
  anomaly found).

**Reused patterns**: GPS-method checkpoints reuse `resolveGeofenceVerified`
directly, same as guard shift check-in. A missed checkpoint (no scan within
some window of the route's expected pace, computed against the linked
shift's window) is a natural `exceptions.ts`-style check, feeding an
`alerts.ts` row — same "extend the existing exceptions engine" approach
`FEATURES.md` §4 already calls for.

## 2. `incidents.ts`

Extends the `fieldReports.ts` pattern already in `dcentral-fieldops` — read
that file in full before writing this one; the shape below assumes its general
structure (submitter, site, category, status, associated media) without having
re-read its exact current columns.

**Proposed shape**:

- `incidents` — `id`, `site_id`, `reported_by_crew_member_id`, `category`,
  `severity` (`low` | `medium` | `high` | `critical` — matches `FEATURES.md`
  §4's escalation tiers), `status` (`open` | `escalated` | `resolved`),
  `summary`, `created_at`, `resolved_at` (nullable).
- `incident_actions` — `id`, `incident_id`, `actor_crew_member_id`,
  `action_type` (`escalated` | `reassigned` | `note_added` | `resolved`),
  `note`, `created_at`. An append-only action log — this is also the natural
  backing for the "tamper-evident incident chain (hash-chained edits)" feature
  in `FEATURES.md` §8: each row can carry a hash of the previous row's content,
  same general idea as the precedent system's audit-trail approach.
- `incident_media` — links into the existing `documents.ts` (photos attached
  to an incident report, or a camera snapshot pulled per `DOMAIN-DESIGN.md`
  §4) rather than a new storage table — precedent already proves this pattern
  for `job_id`/`site_id`/`tags`-linked images.

**Severity escalation** (supervisor bumping severity or reassigning response,
per `FEATURES.md` §3) is an `incident_actions` row, not a mutation that
overwrites `incidents.severity` in place — keeps the append-only property that
makes the tamper-evident chain meaningful.

**Multi-language incident input** (`FEATURES.md` §2): store the guard's
original-language text as submitted; a translated client-facing version is a
derived field, not a second source of truth — don't create two independently
editable text columns.

## 3. Duress/panic alerts

**Status: resolved (2026-09-04)**. Originally "the earlier brainstorm,"
referenced but not captured; the four open questions below have now been
answered by the user.

**Proposed shape**: rather than a new table, this is modeled as a specific
`incidents.category = 'duress'` row with `severity` forced to `critical` at
creation — reuses the same action/escalation/media machinery from §2 instead
of a parallel system. The distinguishing behavior is entirely in the
**client and alerting path**, not the data model:

- **Trigger UX — dedicated hardware button**: a physical trigger (phone
  power-button pattern, e.g. 3× quick press, or a paired wearable/fob), not
  an in-app control — works even with the phone locked or screen off, which
  matters most under real duress. This needs OS-level background listening
  (battery/permissions implications on both iOS and Android) — flag as a
  real implementation risk for whoever scopes the guard app's native shell
  in Phase 2, not a trivial add-on to a web-based app shell.
- **Payload — location + timestamp only**: guard identity, site, GPS
  location, and trigger time. Nothing richer (no audio/video channel).
  Matches the precedent's telemetry-exemption reasoning
  (`PRECEDENT-ARCHITECTURE.md` §5) — this is location data the guard's
  device already emits, kept minimal so the alert sends fast even on a poor
  connection.
- **UI feedback — subtle, deniable**: after triggering, the guard app shows
  a near-invisible cue (e.g. a small icon change or a distinct vibration
  pattern) confirming the alert is active/sending — not a full on-screen
  banner (which would defeat the "must look identical to normal use if
  someone is watching the guard's screen" safety property), but also not
  zero feedback (the guard gets some confirmation it worked).
- **Alert routing — every supervisor overseeing that site**: a `duress`
  incident pages every supervisor scoped to the site, not just the guard's
  own assigned supervisor, at the precedent's most aggressive
  "re-page-until-acknowledged" escalation setting
  (`exceptions.ts`/`notifications.ts`), not the default priority queue.

## 4. `cameras.ts`

The most fully-specified module from the original planning conversation.

**Table**: `cameras` — `id`, `site_id`, `name`, `vendor` (`avigilon` |
`hikvision` | `generic-onvif`), `stream_url_or_device_id`, `location_label`
(e.g. "Main Gate", "Loading Dock"), `active`.

**Architecture**:

- **Protocol-agnostic core, built against ONVIF** as the baseline standard
  (most VMS/NVR systems, Avigilon included, support it). Vendor-specific
  integrations (Avigilon ACC API, HID access-control feeds) are adapters
  implementing one common interface — never the core.
- **No raw video ingestion or storage.** This is a deliberate scope cut to
  avoid a large storage and liability commitment:
  - **Event-driven**: subscribe to motion/analytics events the camera/VMS
    already generates (motion-detected, line-crossing, loitering — via webhook
    or ONVIF event subscription) and turn those into `alerts.ts` rows, reusing
    the existing alert/notification pipeline rather than building a parallel
    one.
  - **Snapshot-on-event, not stream, for evidence**: on a triggered event, or
    a guard manually flagging "capture footage" from an incident report, pull
    one still frame via the camera's snapshot API and store it through the
    existing `documents.ts` — attaches directly to an incident, no new storage
    system.
- **Checkpoint corroboration**: if a guard scans a checkpoint near a camera,
  optionally pull a snapshot at that timestamp as a secondary verification
  layer on top of GPS (ties `cameras.ts` to `checkpoints.ts` above).

**Sovereignty tier — resolved (2026-09-04)**, three real entries now in
`policy/sovereignty_tiers.yaml`, decided per vendor adapter (not blanket) per
`PRECEDENT-ARCHITECTURE.md` §4's discipline:

| Entry | Status | Why |
|---|---|---|
| `camera_events_onvif` (generic-onvif, hikvision) | `self_hosted_required` | Device-to-device protocol against a camera/NVR on the client's own network — no third party in the path at all |
| `camera_events_avigilon_acc_onprem` | `self_hosted_required` | Same reasoning, for a client-owned on-prem ACC server — the common Avigilon deployment shape |
| `camera_events_avigilon_cloud` | `external_pending` | Only when a site runs the cloud-hosted Avigilon Alta/Cloud product instead of on-prem ACC — genuinely undecided until a real client on this product path exists and its data-handling terms get reviewed |

**Important**: the vendor name alone doesn't determine the tier — Avigilon
ships both an on-prem product (ACC) and a cloud one (Alta/Cloud). Whoever
wires up a specific client site must confirm which product that site
actually runs before assuming the on-prem entry applies. If a
`generic-onvif` deployment is ever found proxying through a cloud NVR
product, that specific case needs its own reviewed entry too — the current
`self_hosted_required` status assumes the on-prem case this module was
designed for.

**Explicitly out of scope, by deliberate decision**: a full VMS replacement,
live video streaming into the app, facial-recognition matching. If SAFR-style
facial recognition is wanted later, treat it as its own sovereignty-tier
decision and its own phase — never fold it into this module's scope.

## 5. Certification gating

**Status: resolved (2026-09-04)**. Originally referenced twice
("certification-gap checks" in the exceptions engine, "guard performance/
compliance glance" in the supervisor app) without a captured rule model; the
two open questions below have now been answered by the user.

**Decision — per-post granular, soft flag**:

- **Granularity**: required certs attach to individual **posts** within a
  site, not the site as a whole. A site with a mixed roster (e.g. an armed
  perimeter post and an unarmed lobby post) needs different cert
  requirements per post, not one undifferentiated site-level list. Proposed
  shape: a `post_required_certs` table — `id`, `post_id`, `cert_type`,
  `required` — rather than a single column on `sites`.
- **Gating behavior**: a missing cert is a **soft flag, not a hard block**.
  The assignment can still be made — the gap is surfaced as a visible,
  auditable warning to the supervisor at assignment time (ties into
  `FEATURES.md` §3's "guard performance/compliance glance before
  last-minute assignment"), not structurally prevented. This trades some
  compliance safety for the flexibility a real staffing operation needs
  (e.g. covering a last-minute no-show with the best available guard rather
  than leaving a post unstaffed) — same instinct the precedent applies
  elsewhere of treating "flagged but allowed" and "blocked" as genuinely
  different states rather than collapsing them, just resolved toward the
  flag side here since a hard block was judged too rigid for staffing
  reality.
