# Architecture

D-Central-native successor to `fieldops-system` (v1) — built clean-slate per the approved plan (see the plan file this session was built from). v1 stays live for Sod Boys Ltd throughout this build; nothing here touches it.

## Status (2026-08-XX, Phase 1 in progress)

**Built and typechecked clean:**
- Identity/capability/federation-stub Postgres schema (`src/db/migrations/`)
- Sovereignty-tier policy (`policy/sovereignty_tiers.yaml`) + sync script
- Veramo agent: `did:key` (via `@veramo/did-provider-key`) and a custom `did:webvh` provider (`src/identity/webvhDidProvider.ts`) wrapping `didwebvh-ts` — no ready-made Veramo↔didwebvh-ts bridge exists on npm, confirmed by search, so this is genuinely new integration code
- Capability-grant issue/verify (`src/identity/capabilities.ts`)
- MCP server (`src/mcp/server.ts`) with `whoami`/`list_capabilities` tools, gated by capability-tier middleware, over both stdio and Streamable HTTP transports
- `FederationTransport` interface + loopback implementation (`src/federation/`)

**Verified live (not just typechecked) via vitest, `npm test`:**
- `test/veramo.did.test.ts` — did:key create/resolve/delete via Veramo; did:webvh log creation + resolution from an in-memory log via didwebvh-ts directly (no live HTTPS endpoint needed for this test — see "Known gaps" below for what that means for real network resolution)
- `test/veramo.vc.test.ts` — VC issue/verify, tampered-JWT rejection, and a documented upstream expiration-checking gap (see below)

**Now verified live against a real database — all 4 test files, 13/13 tests passing:**
- `test/capabilities.test.ts` — DB-backed capability grant issue → verify → revoke lifecycle, wrong-capability rejection, unknown-credential rejection
- `test/mcp.test.ts` — `whoami`/`list_capabilities` over a real `McpServer` via `InMemoryTransport`, capability-gating allow/deny

Postgres runs via `docker-compose.yml` at the repo root (`pgvector/pgvector:pg16`, published on host port **5433**, deliberately not 5432 — avoids any collision with v1 (`fieldops-system`)'s own postgres container or anything else already bound to the host's default Postgres port):
```bash
docker compose up -d
npm run migrate
npm run sync:policy   # after setting reviewed_by/reviewed_at in policy/sovereignty_tiers.yaml
npm test
```

A real, genuine bug turned up on the first run once a database actually existed: `test/capabilities.test.ts` and `test/mcp.test.ts` each inserted their own test-fixture row into `nodes` with `is_self: true` — fine in isolation, but `nodes_single_self_idx` correctly enforces that flag as a global singleton across the whole database, so whichever file's insert ran second failed with a unique-constraint violation. Not a schema bug (the constraint did exactly its job); the tests were wrong to claim `is_self: true` for an arbitrary fixture node. Fixed in both files (`is_self: false` — they don't need to *be* the deployment's self-node, just a valid FK target for `capability_grants.issuer_node_id`). Also confirmed clean: both files' `afterAll` cleanup leaves zero residual rows in `nodes`/`capability_grants`/`verifiable_credentials`.

Docker Desktop had been failing to accept connections through this environment's shell in an earlier attempt this session (GUI running, daemon unreachable) — resolved itself by the time this was retried; no fix was needed here beyond retrying. Worth knowing for next time: `npm test` at the repo root will also pick up `vendor/openconstructionerp`'s own (large, unrelated, jsdom-dependent) test suite unless scoped — `vitest.config.ts` now sets `include: ["test/**/*.test.ts"]` / `exclude: ["vendor/**", ...]` specifically to prevent that.

## Real bugs found and fixed during Phase 1 testing (kept as a record, not just fixed silently)

Testing against the real Veramo/didwebvh-ts/MCP SDK APIs surfaced four genuine defects that pure typechecking never would have caught — all fixed in both the test code and the actual production files they affected:

1. **`createDID` and `resolveDID`/`resolveDIDFromLog` both require a working `verifier`, not just a `signer`.** The original code only ever passed a signer. `webvhResolver.ts`'s production resolution path would have thrown `"Verifier implementation is required"` on the very first real `did:webvh` resolution — this was never exercised until the test suite actually called it. Fixed by adding a shared, stateless `src/identity/ed25519Verifier.ts` used by both the provider and the resolver.
2. **Multikey encoding was wrong.** A `Multikey`-typed verification method's `publicKeyMultibase` isn't just the raw public key bytes multibase-encoded — the W3C Multikey spec requires a 2-byte multicodec prefix (`0xed01` for Ed25519) before multibase-encoding. Every `did:webvh` identifier this provider created before the fix would have failed didwebvh-ts's own log validation (`"multiKey doesn't include ed25519 header"`).
3. **`@veramo/credential-jwt` 7.0.0's `verifyCredential` does not enforce JWT expiration by itself**, `policies: { expirationDate: true }` notwithstanding — reproduced directly: a hand-built JWT-VC with `exp` 30 seconds in the past still verified as `true`. This is pinned as a known, documented upstream gap (`test/veramo.vc.test.ts`'s last test asserts the *current*, non-enforcing behavior specifically so a future dependency upgrade that fixes it gets noticed, not silently missed) and worked around with an explicit application-level expiration check in `capabilities.ts`'s `verifyPresentedCapability` — the real enforcement this system actually depends on.
4. **`CredentialPlugin` requires an explicit JWT credential provider** (`new CredentialPlugin([new CredentialProviderJWT()])` from `@veramo/credential-jwt`) — the zero-argument form doesn't exist; `@veramo/credential-w3c` alone has no proof-format implementation of its own.

## Technology decisions

See the approved plan for full reasoning. Summary:
- **DID method**: `did:webvh` for the node's own long-lived identity (DIF-governed, resolves over plain HTTPS, hash-chained key-rotation history — no blockchain dependency); `did:key` for agent instances and short-lived delegation keys.
- **VC library**: Veramo (`@veramo/core` + `did-manager`/`key-manager`/`kms-local`/`did-provider-key`/`did-resolver`/`credential-w3c`/`credential-jwt`).
- **MCP framework**: the official `@modelcontextprotocol` TypeScript SDK — `@modelcontextprotocol/server` (v2, current spec generation), `/client` for testing, `@modelcontextprotocol/node`'s `toNodeHandler` for the Streamable HTTP transport's plain-Node wiring.
- **Capability layer**: a custom VC-based capability-grant model (`CapabilityGrant` VCs + a Postgres `capability_grants` index), rather than a full UCAN implementation — simpler to get genuinely correct in Phase 1, revisit UCAN specifically if delegation chains (not just direct node→agent grants) become necessary.
- **Backend**: Node/TypeScript (Veramo, the MCP SDK, and OpenClaw's plugin ecosystem are all TS-native).
- **Database**: Postgres, no separate graph DB. pgvector for the future knowledge/RAG layer is deferred to Phase 2+ (no domain knowledge base exists yet to index).
- **`did-resolver` version pinned to `^4.1.0`**, not the newer `5.0.1` — `@veramo/core-types` depends on `did-resolver@^4.1.0` internally, and TypeScript's structural typing treats the two majors' `DIDResolutionResult` as genuinely incompatible types (not just a version-string mismatch) when both are present. Installing the same major Veramo already depends on avoids the clash entirely.
- **`zod` pinned to `^4.4.3`, not `3.x`** — this MCP SDK generation's `registerTool` expects Zod's native Standard Schema V1 support (specifically `jsonSchema` on the schema's `~standard` props), which only zod v4 implements. Passing a zod v3 schema fails both of `registerTool`'s overloads.

## D-Central-native architecture layers

- **Node identity**: one `did:webvh` per deployment — root of trust issuing capability VCs to agent DIDs.
- **Agent identity**: each distinct agent role gets its own `did:key`, holding a VC from the node DID stating its capability tier and capability set.
- **Crew members**: explicitly **no DID/VC** for known, steady crew — phone number stays the identity primitive in the domain layer built in Phase 2. A future guerrilla/gig-crew extension is the one place DID/VC for a person actually earns its cost; deliberately not built here.
- **Capability tiers**: 0 read-only, 1 propose/draft, 2 execute non-financial/non-schedule, 3 execute money/schedule/inventory, 4 admin/self-modifying. Every MCP tool declares its minimum tier; `src/mcp/middleware.ts`'s `requireCapability` enforces it per call.
- **Sovereignty-tiering policy**: `policy/sovereignty_tiers.yaml`, mirrored to Postgres by `npm run sync:policy`. Currently names LLM inference (accepted, multi-provider fallback bounds the risk), reverse-geocoding, weather, and pgvector embedding generation (all `external_pending` — real decisions, not v1's silent defaults) and federation transport (`self_hosted_required` by definition). **Has never actually been reviewed** (`reviewed_by`/`reviewed_at` are `null`) — this is a hard gate before Phase 2 domain logic is allowed to call anything external.
- **MCP as universal surface**: every capability, D-Central-layer and future domain-layer alike, is an MCP tool. Capability checks are argument-based (`credentialJwt` passed in the tool call itself), not HTTP-bearer-only, specifically because it has to work identically over stdio, which has no HTTP layer to carry a bearer token.
- **Federation, genuinely single-node**: `src/federation/FederationTransport.ts` is a real interface with one real (not stubbed-to-throw) loopback implementation. `federation_peers`/`federation_proposals`/`federation_votes`/`dcredit_ledger` tables exist and function correctly at N=1 (a quorum-of-one vote is a degenerate but real instance of the same code path a second node would use) — a second node later means a new `FederationTransport` implementation and new rows, not a schema change.

## OpenClaw MCP-client integration (Phase 1 spike, resolved)

**OpenClaw has genuine, mature native MCP client support** — confirmed directly via its own CLI (`openclaw mcp --help`), not assumed:

```
openclaw mcp add <name> --transport streamable-http --url <url> [--parallel] [--include <csv>] [--exclude <csv>]
openclaw mcp probe          # connect to configured MCP servers and list capabilities
openclaw mcp status         # transport status without connecting
openclaw mcp doctor         # check for static setup problems
openclaw mcp tools          # per-server tool include/exclude filters
```

No adapter plugin is needed — the fallback path considered in the original plan doesn't apply. Registering this system's MCP server with OpenClaw once Phase 3 wires up real WhatsApp interaction is a config operation:

```bash
openclaw mcp add dcentral-fieldops --transport streamable-http --url http://localhost:8090 --parallel
```

**Open design question for Phase 3, not resolved here**: this system's capability check is argument-based (`credentialJwt` per tool call), which means the OpenClaw agent itself needs to hold and present an agent DID's VC on every call. How the agent obtains and injects that VC (a plugin-level wrapper reusing a pattern from v1's `fieldops-tools`, an OpenClaw config-level credential the gateway attaches automatically, or something else) is real design work for whenever domain tools actually get built and wired to a live agent — named here so it isn't lost, not answered.

## Known gaps (real, not hidden)

- **Key/DID material is held in Veramo's in-memory stores** (`MemoryKeyStore`/`MemoryPrivateKeyStore`/`MemoryDIDStore`) — real and working, but **not durable across a process restart**. Acceptable for proving the Phase 1 flow end to end; a hard blocker before this agent identity is used for anything beyond local dev/testing. The domain data this system actually cares about long-term (`capability_grants`, `nodes`, `agent_identities`) already lives in real Postgres — only the raw private key material is affected.
- **`WebvhDIDProvider.updateIdentifier`/`addKey`/`removeKey`/`addService`/`removeService` are not implemented** — key rotation via `didwebvh-ts`'s `updateDID` is real future work.
- **`did:webvh` full network resolution has never been tested against a live HTTPS endpoint** — only against an in-memory log (`resolveDIDFromLog`), which proves the cryptography and log-chain logic but not the actual HTTP fetch/domain-serving path. Needs a real domain decision (see "Open decisions" below) before that's testable.
- **The `@veramo/credential-jwt` expiration-checking gap** (see "Real bugs found" above) — worked around at the application layer, but worth re-checking on any future Veramo upgrade.

## Open decisions (unblocked from Phase 1, real before Phase 2)

1. Exact hosting device for the eventual deployment (Pi 5 vs. mini-PC vs. eventual VPS — VPS would need an explicit sovereignty-tier exception, not a default).
2. Domain for the node's `did:webvh` — under `sodboysltd.org` (the v1 client-facing domain) or a separate D-Central-branded domain. Blocks real network-resolution testing.
3. Local vs. external embedding model for pgvector, once a knowledge base exists to embed.
4. ~~Dashboard as an MCP client itself vs. a thin REST façade~~ — **decided**, see "Frontend" below: a full React SPA naturally consumes a REST/JSON API, not MCP-over-HTTP in-browser. A thin REST façade in front of the same MCP tool implementations is now the plan, not just a lean.
5. What v1 data is worth migrating vs. re-bootstrapping fresh, in the eventual Phase 4 cutover.
6. **Review and approve `policy/sovereignty_tiers.yaml`** — currently unreviewed, which is itself a decision that needs making, not deferring indefinitely.

## Frontend

Decided by explicit instruction, not the default this repo would otherwise have arrived at: the dashboard reuses [OpenConstructionERP](https://github.com/datadrivenconstruction/OpenConstructionERP)'s frontend rather than being built from scratch. Vendored as a git submodule at `vendor/openconstructionerp` (the *whole* upstream monorepo — it has its own `backend/`, `modules/`, `services/`, etc. alongside `frontend/`; only the `frontend/` subdirectory is actually used here). Submodule, not a squashed copy, specifically so its own `LICENSE`/`NOTICE`/`CONTRIBUTORS.md` stay intact and separately trackable against upstream — that matters for the point below, not just for pulling updates.

**License, stated plainly since it has real teeth**: OpenConstructionERP is AGPL-3.0. Confirmed and accepted directly, not a default — see the instruction that added this. The concrete mechanism, so "accepted" means the actual thing and not a vaguer one: AGPL-3.0's network-use clause (§13) means that if this system is modified and made available to users over a network (which a live FieldOps deployment is, by definition), the complete corresponding source of the *combined work* must be offered to every user who interacts with it — not just to someone who receives a distributed copy. Depending on how tightly the frontend and this system's own backend end up integrated (a separate REST API consumed over HTTP is the safer shape; statically linking or bundling code together is not), this plausibly extends the AGPL obligation to more than just `vendor/openconstructionerp/frontend/`'s own files. Two things worth knowing, found while vendoring, not previously flagged: OpenConstructionERP ships a `COMMERCIAL-LICENSE.md` — a paid non-AGPL license option exists from the upstream project if the AGPL obligation ever conflicts with the licensing/franchise business direction discussed for this system (see the wider planning history); and the vendored repo is a substantially more capable frontend than earlier design research assumed — React 18 + TypeScript + Vite, but also TanStack Query, AG Grid, MapLibre GL, Cesium (3D/geospatial), react-i18next, react-router-dom v7, not the smaller React/Tailwind/Recharts/Zustand stack previously described.

**Not yet done, real follow-up work**: actually wiring `vendor/openconstructionerp/frontend/` to this system's backend. It's a large, general-purpose construction-ERP UI (project/estimating/BIM/procurement workflows) that needs real adaptation to FieldOps' actual domain (dispatch, crew, sites, checkouts, exceptions) — not just an API base URL pointed at a new backend. Concretely: a thin REST façade needs to sit in front of the MCP tool implementations for the browser to call (see decision #4 above), the nav/routing needs cutting down to FieldOps' actual screens, and auth needs a real design (this system's capability-VC model is agent-to-agent, not a browser session model — the dashboard needs its own login story, not a repurposed agent DID). None of this is started.
