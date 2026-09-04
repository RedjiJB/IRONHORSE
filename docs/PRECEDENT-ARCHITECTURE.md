# Precedent Architecture — dcentral-fieldops

**What this is**: a real, verified read of `dcentral-fieldops`
(`https://github.com/RedjiJB/sodboys-fieldops.git`, local clone at
`C:\Users\jredj\dev\dcentral-fieldops`) — the system IRONHORSE is designed to
follow architecturally. Everything below was confirmed against the actual
repo (`src/domain/*.ts`, `policy/sovereignty_tiers.yaml`, `docs/ARCHITECTURE.md`)
on 2026-09-04, not reconstructed from memory or from the planning chat alone.
Re-verify against the live repo before relying on specifics here — it is an
actively developed system and this snapshot will drift.

---

## 1. What dcentral-fieldops actually is

A D-Central-native field-operations backend for **Sod Boys Ltd**, a landscaping
company — built clean-slate as the successor to an earlier system
(`fieldops-system`, "v1"). Deployed at `dashboard.sodboysltd.org`
(REST façade) and `id.sodboysltd.org` (MCP transport + DID document).

Two layers, kept deliberately separate:

- **`src/identity/`** — the D-Central zero-trust identity/capability layer (DIDs,
  verifiable credentials, capability grants). Domain-agnostic — nothing in here
  knows what a "crew member" or a "site" is.
- **`src/domain/`** — the actual field-ops business logic (sites, crew, shifts,
  timeclock, inventory, payroll, alerts, etc.). Everything IRONHORSE's own
  domain modules should be modeled after.

## 2. The identity / capability model

Every actor in the system — the node itself, every automated agent, every crew
member — is a real cryptographic identity, not a database role column.

- **DID method**: `did:web` for everyone. The node gets a bare-domain DID
  (`did:web:id.sodboysltd.org`); each agent role gets a path-based sub-DID
  (`did:web:id.sodboysltd.org:agents:<role>`); each crew member gets
  `did:web:<domain>:crew:<uuid>`.
- **Custodial for crew**: crew members don't hold a wallet — the node generates
  and stores their keypair. They interact purely through WhatsApp text (or, for
  IRONHORSE, presumably the guard/supervisor mobile app). Their phone number is
  a signed `PhoneBinding` verifiable credential bound to that DID, not the
  primary identity itself.
- **VCs are hand-rolled, not a framework**: `src/identity/vc.ts` is a
  from-scratch JWT-VC implementation on top of `jose` (which supplies only
  JWS/JWT mechanics, RFC 7515/7519 — no DID/VC opinions of its own). An earlier
  Veramo-based build was fully removed by explicit instruction; the dependency
  count dropped from 171 packages to 89 as a direct result. **Don't reach for
  Veramo, `didwebvh-ts`, or a VC framework for IRONHORSE either** — this
  project has already tried that path and reversed it.
- **Two independent authorization axes**, each checked separately, never one
  masking the other:
  1. **MCP capability tier** — which agent DID may call a given tool at all.
  2. **Crew role capability** (`hasManagementCapability`, backed by
     `checkStandingCapability`) — which *human*, by crew DID, may actually
     approve/act. This is a live cryptographic re-check every time, not a
     cached role string — proven by a test that revokes a manager's grant
     mid-test and confirms the check flips to `false` immediately.
- **Capability tiers** (declared per MCP tool, enforced by
  `src/mcp/middleware.ts`'s `requireCapability`):
  - **0** — read-only
  - **1** — propose/draft
  - **2** — execute non-financial/non-schedule
  - **3** — execute money/schedule/inventory
  - **4** — admin/self-modifying

## 3. The confirm-before-execute pattern

This is the single most important reusable pattern for IRONHORSE's guard/
supervisor approval flows.

`src/domain/confirmations.ts` is an **open registry**:
`registerConfirmationExecutor(actionType, executor)`. Any action a crew member
proposes but shouldn't unilaterally execute — their own timeclock hours, a
damage claim, a consumable-quantity adjustment, a delivery-receipt claim — goes
through the same shape:

1. The submitting call **creates a row and returns `awaiting_review`** — it
   does not execute anything directly.
2. A reviewer with the right crew-role capability calls
   `approve_pending_confirmation` (or `reject_...`).
3. On approval, the registered executor **re-resolves state fresh against
   *current* reality**, not what was true at submission time (e.g.
   `geofence_verified` is recomputed against the site's *current* geofence at
   approval time, not cached from submission).
4. Reviewer authorization is checked via `hasManagementCapability`, a genuinely
   separate check from "does this agent's MCP capability tier allow calling
   this tool at all."

**Why this matters for IRONHORSE**: the supervisor approve/reject queue design
in `docs/FEATURES.md` §3 is explicitly meant to reuse this exact mechanism —
guard-submitted timeclock corrections, shift extensions, and incident
escalations are all confirm-before-execute candidates, and the precedent system
already proves the pattern works with **one executor implementation per action
type** (a deliberate improvement over the "v1" system it replaced, which
duplicated transition logic between a direct route and an approval path).

## 4. Sovereignty tiering — the discipline, not just the file

`policy/sovereignty_tiers.yaml` exists because an earlier system crossed
external-network boundaries **by default, with no decision on record**, twice
(LLM provider calls, reverse-geocoding). This file exists specifically so that
never happens silently again.

**Every function class that touches a network boundary outside the node's own
infrastructure gets its own real, dated, reviewed decision** — not a blanket
sign-off. Status values:

| Status | Meaning |
|---|---|
| `external_accepted` | External API use is a deliberate, reviewed tradeoff |
| `external_pending` | Currently external, needs a real decision before dependent domain logic ships |
| `self_hosted_required` | Must never leave this node's own infrastructure |
| `self_hosted_planned` | External for now, self-hosted replacement planned before production |

Real examples from the live file, worth reading as *how to reason*, not just
what was decided:

- **LLM inference** — `external_accepted`. Self-hosting a model capable of
  reliable tool-use on modest hardware isn't currently viable at the needed
  quality bar. Mitigated by a multi-provider fallback chain and by every
  mutating action still routing through confirm-before-execute regardless of
  which model produced it — "the sovereignty boundary is crossed, but the
  blast radius of a bad model output is bounded by that gate, not by keeping
  inference local."
- **Reverse/forward geocoding** — `external_accepted`. The reasoning is
  specific, not generic: the coordinate (not its human-readable address) is
  the sensitive part, and the coordinate already has to exist in the system
  regardless — geocoding it doesn't meaningfully increase exposure.
  Self-hosting Nominatim was judged disproportionate to the marginal privacy
  gain.
- **Embedding generation** — `external_pending`, genuinely undecided (not
  deferred out of caution) because the real blocker — a local-model benchmark
  on actual target hardware — doesn't exist yet.
- **Federation transport** — `self_hosted_required` by definition (node-to-node
  traffic within the system's own trust boundary is never a third-party
  dependency), marked reviewed for completeness even though it's "not really a
  judgment call."

**Direct implication for IRONHORSE's camera module** (see
`docs/DOMAIN-DESIGN.md` §4): camera feeds are meaningfully more sensitive than
a coordinate or a weather query, and the tier decision must be **explicit
per-vendor-adapter** — an on-prem NVR/VMS query (`self_hosted_required`,
nothing leaves the client's network) is a different tier decision than a cloud
VMS in the path (`external_pending` until reviewed).

## 5. Confirm-before-execute exemptions (also load-bearing)

Not everything goes through the two-party flow. Passive telemetry a person
already chose to send is explicitly exempted — `log_vehicle_location`/
`log_location_share` are *not* confirm-before-execute, on the reasoning that
"a crew member already chose to send this, it's not a decision made on their
behalf." Contrast with timeclock events or damage claims, which are always
two-party confirmed. **IRONHORSE's guard location pings should follow the
telemetry exemption; a guard's incident report or duress alert should not** —
match the precedent's reasoning (is this passive data the person already chose
to emit, or a claim that needs independent verification?), not a blanket rule.

## 6. Domain module inventory (as of this snapshot)

`src/domain/` currently has 40 modules. Grouped by what they cover:

- **Dispatch backbone**: `sites.ts`, `crewMembers.ts`, `jobTypes.ts`, `jobs.ts`, `shifts.ts`, `timeclock.ts`, `timeclockSessions.ts`, `confirmations.ts`, `geo.ts`
- **Inventory/logistics**: `vendors.ts`, `assets.ts`, `consumables.ts`, `loadouts.ts`, `checkouts.ts`, `orders.ts`, `transfers.ts`, `purchaseOrders.ts`
- **Fleet**: `vehicles.ts`, `telemetry.ts`, `trips.ts`
- **Alerting/ops**: `alerts.ts`, `notifications.ts`, `notificationSettings.ts`, `exceptions.ts`, `systemHealth.ts`, `documents.ts`
- **Payroll/spending/auth**: `users.ts`, `sessions.ts`, `loginTokens.ts`, `loginAttempts.ts`, `payroll.ts`, `spending.ts`, `mileageClaims.ts`, `moneyInstruments.ts`
- **Chat/AI**: `chat.ts`, `llmSettings.ts`
- **Misc**: `activity.ts`, `kpis.ts`, `weather.ts`, `webhookTargets.ts`

**Each module pairs with**: a numbered migration (`src/db/migrations/00NN_*.sql`),
an MCP tool file (`src/mcp/tools/*.ts`), and — where a browser needs to reach it
— a REST façade route (`src/facade/routes/*.ts`). IRONHORSE's new modules
(`patrols.ts`, `checkpoints.ts`, `incidents.ts`, `cameras.ts` — see
`docs/DOMAIN-DESIGN.md`) should follow this exact four-part shape.

## 7. The REST façade — why it exists, and its real limits

The frontend is a **vendored, forked** copy of
[OpenConstructionERP](https://github.com/datadrivenconstruction/OpenConstructionERP)
(git submodule at `vendor/openconstructionerp`) — a general-purpose
construction-ERP React SPA, not built from scratch, by explicit decision. A
thin REST façade (`src/facade/`) sits in front of the same MCP tool
implementations so a browser can call JSON/HTTP instead of MCP-over-HTTP.

**Real, load-bearing limits found while wiring this**, worth internalizing
before IRONHORSE repeats the same integration:

- The vendored frontend has a much richer data model in places than the
  backend domain does (e.g. its `Equipment` type has manufacturer/model/serial/
  depreciation fields; its payroll/procurement/teams pages assume a `Projects`
  concept this domain doesn't have). The façade **maps, emulates fixed stubs,
  or honestly 404s** — it does not fake data. A dead frontend feature calling
  an unbuilt endpoint should degrade to an isolated 404, not a silent empty
  state that looks like "no data" when it's actually "not implemented."
- Every project-scoped vendored page (`site-inventory`, `procurement`,
  `payroll`, `teams`, `field-time`) is client-side gated on an
  `activeProjectId` this domain doesn't have a real concept of. The fix used
  here: establish one **fixed synthetic project** id per session rather than
  building a whole Projects module with nothing behind it.
- **AGPL-3.0 applies** to the vendored frontend, confirmed and accepted
  deliberately, not a default. Its §13 network-use clause means a live
  deployment that's a *combined work* with the backend must offer full
  corresponding source to every user who interacts with it over the network —
  not just someone who receives a distributed copy. A commercial (non-AGPL)
  license option exists from the upstream project if this ever conflicts with
  IRONHORSE's business direction. **If IRONHORSE reuses this same vendored
  frontend, this licensing decision needs its own explicit review** — don't
  assume dcentral-fieldops's acceptance carries over automatically.

## 8. Production lessons worth inheriting directly

- **Never build the frontend on the same 1GB production box it deploys to.**
  A real incident: an on-box `tsc -b` build exhausted memory/swap and made the
  box unresponsive to SSH/HTTPS for over an hour. Build locally, ship the
  pre-built `dist/` via tar/scp. (This exact lesson was re-learned the hard way
  during IRONHORSE's own sibling project, `dcentral-fieldops`'s Sod Boys demo
  prep — see that project's own memory notes if available.)
- **Backup restore must be tested for real**, not just backup creation — spin
  up a throwaway Postgres container, restore into it, verify coherent data
  landed. This was an open gap for most of the precedent project's history
  before being closed.
- **A health-check heartbeat needs an external vantage point**, not just
  self-monitoring — the facade box's own heartbeat can't detect itself being
  totally unreachable; a separate box checking the public endpoints from
  outside is what actually catches a full outage.
- **Version-control ops scripts from day one** — the precedent project's
  server-side ops scripts were created ad hoc via SSH for a long stretch before
  being moved into `ops/server/` under version control.

## 9. What to read directly before writing IRONHORSE code

This document is a snapshot, not a replacement for the source. Before
implementing any new domain module:

1. Read the closest analogous module in `dcentral-fieldops/src/domain/` in
   full (e.g. `fieldReports.ts` before writing `incidents.ts`;
   `checkouts.ts`/`assets.ts` before anything involving guard equipment issue).
2. Read `dcentral-fieldops/docs/ARCHITECTURE.md` in full — it's a chronological
   build log with real bugs found and fixed, real scope decisions and their
   reasoning, and an "Open decisions" section tracking what's still genuinely
   unresolved. Far more detail lives there than is repeated here.
3. Check `policy/sovereignty_tiers.yaml` for whether a function class IRONHORSE
   needs already has a reviewed entry (weather, geocoding) or needs a new one
   (camera vendor APIs almost certainly do).
