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

**Status: [gap]** — the original planning conversation referenced "the
patrol/checkpoint module from earlier" without capturing its design. What
follows is a first-pass sketch built from the feature description alone
("QR/NFC/GPS-verified patrol routes with exception reporting"); confirm the
real design intent with the user before treating this as settled.

**Proposed shape**:

- `patrol_routes` — `id`, `site_id`, `name`, `active`. A named, reusable route
  definition per site (e.g. "Perimeter — night shift").
- `checkpoints` — `id`, `patrol_route_id`, `sequence`, `label`, `verification_method`
  (`qr` | `nfc` | `gps`), `qr_or_nfc_token` (nullable — only for those methods),
  `lat`/`lng`/`radius_m` (nullable — only for `gps`).
- `patrol_runs` — `id`, `patrol_route_id`, `guard_crew_member_id`, `started_at`,
  `completed_at` (nullable), `status` (`in_progress` | `completed` |
  `abandoned`).
- `checkpoint_scans` — `id`, `patrol_run_id`, `checkpoint_id`, `scanned_at`,
  `verified` (bool — did the QR/NFC/GPS check actually pass), `exception_note`
  (nullable — a guard's free-text note when a checkpoint was skipped or an
  anomaly found).

**Reused patterns**: GPS-method checkpoints reuse `resolveGeofenceVerified`
directly, same as guard shift check-in. A missed checkpoint (no scan within
some window of the route's expected pace) is a natural `exceptions.ts`-style
check, feeding an `alerts.ts` row — same "extend the existing exceptions
engine" approach `FEATURES.md` §4 already calls for.

**Open question for the user**: does a `patrol_run` need to be pre-scheduled
(tied to a shift), or can a guard start one ad hoc? This changes whether
`patrol_runs` needs a `shift_id` FK.

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

**Status: [gap]** — "the earlier brainstorm" is referenced but not captured.
Sketched here as a *minimal* first design to unblock discussion, not a
finished spec.

**Proposed shape**: rather than a new table, this is plausibly best modeled as
a specific `incidents.category = 'duress'` row with `severity` forced to
`critical` at creation — reuses the same action/escalation/media machinery
above instead of a parallel system. The distinguishing behavior is entirely in
the **client and alerting path**, not the data model:

- Guard app: a duress trigger is a single, hard-to-mis-tap control, separate
  from the normal "report incident" flow (the feature list explicitly calls
  for this to be a *silent* alarm — no confirmation dialog, no "are you sure").
- Alert routing: a `duress` incident should page **every supervisor
  overseeing that site immediately**, not the normal notification-priority
  queue — this is the one incident type where the precedent system's flat
  "re-page the same recipients until acknowledged" escalation pattern
  (`exceptions.ts`/`notifications.ts`) should apply at its most aggressive
  settings, not the default.

**Open questions for the user**: What exactly gets sent on trigger (location
only, or an open audio/video channel)? Does the guard app show any UI feedback
that duress mode is active, or does it need to look identical to normal use
for the guard's safety? These materially change the design and should be
resolved before implementation, not assumed.

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

**Sovereignty tier — required before this ships**, following the exact
discipline in `PRECEDENT-ARCHITECTURE.md` §4: add a `camera_events` (or
per-vendor) entry to `policy/sovereignty_tiers.yaml` with a real, dated,
reasoned decision. The likely split:

- **`self_hosted_required`** when pulling from an on-prem NVR/VMS the client
  already owns — no data leaves their network, this system only queries it.
- **`external_pending`** (until reviewed) when any cloud VMS is in the path
  (e.g. Avigilon Cloud).

This must be decided **per vendor adapter**, not blanket — an ONVIF query
against a client's own on-prem NVR and a call to a cloud VMS API are not the
same tier decision even though both are "camera integration."

**Explicitly out of scope, by deliberate decision**: a full VMS replacement,
live video streaming into the app, facial-recognition matching. If SAFR-style
facial recognition is wanted later, treat it as its own sovereignty-tier
decision and its own phase — never fold it into this module's scope.

## 5. Certification gating

**Status: [gap]** — referenced twice in the planning conversation
("certification-gap checks" in the exceptions engine, "guard performance/
compliance glance" in the supervisor app) but the actual rule model isn't
captured.

**Open questions for the user**, needed before this can be designed
concretely: How is a "required site cert" defined and attached to a site — a
site-level list of required cert types, or something more granular (per-post)?
Is gating a hard block (assignment structurally cannot be made) or a
soft flag (assignment allowed, but surfaced as a warning to the supervisor)?
The precedent system's own conventions favor being explicit about this kind of
distinction rather than defaulting to one — see how `alerts.ts` deliberately
separates "acknowledged" from "resolved" as two different real states, and
apply the same instinct here: don't collapse "guard lacks cert" into a single
undifferentiated warning if a hard-block case and a soft-flag case are both
real requirements.
