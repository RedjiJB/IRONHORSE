# Architecture

D-Central-native successor to `fieldops-system` (v1) — built clean-slate per the approved plan (see the plan file this session was built from). v1 stays live for Sod Boys Ltd throughout this build; nothing here touches it.

## Status (2026-08-21, Phase 1 in progress)

**Identity stack replaced mid-Phase-1, by explicit instruction: no Veramo, no `didwebvh-ts`.** The section below this one ("Real bugs found...") describes the Veramo-based implementation that was built, tested, and working — kept as a historical record since the bugs found there are genuinely instructive, not because that code still exists. It was fully removed and replaced with a from-scratch `did:web` + JWT-VC implementation (no framework, ~250 lines total across `did.ts`/`keys.ts`/`vc.ts`) built directly on Node's native Ed25519 support and `jose` (a minimal JWS/JWT mechanics library, not a DID/VC framework — see "Technology decisions" below). The dependency count dropped from 171 packages to 89 as a direct result.

**Built and typechecked clean:**
- Identity/capability/federation-stub Postgres schema (`src/db/migrations/`), now including `keys` (0005) for the new key storage
- Sovereignty-tier policy (`policy/sovereignty_tiers.yaml`) + sync script
- `src/identity/keys.ts` — Ed25519 keypair generation (`jose.generateKeyPair`) and Postgres-backed storage (JWK, not Veramo's in-memory stores)
- `src/identity/did.ts` — `did:web` construction (bare-domain for the node, path-based `:agents:<role>` sub-DIDs for agents), DID document building, and resolution (local-DB fast path for this node's own DIDs, real HTTPS fetch fallback for anything else)
- `src/identity/vc.ts` — JWT-VC issue/verify as plain signed JWTs (EdDSA), no VC framework
- Capability-grant issue/verify (`src/identity/capabilities.ts`) — unchanged in shape, now calls `vc.ts` instead of Veramo
- `src/mcp/transports/http.ts` now serves `/.well-known/did.json` (node) and `/agents/<role>/did.json` (agents) — the actual HTTPS endpoints a remote resolver would fetch
- MCP server (`src/mcp/server.ts`) with `whoami`/`list_capabilities` tools, gated by capability-tier middleware, over both stdio and Streamable HTTP transports — **unchanged by the identity-stack swap**, since it only ever depended on `capabilities.ts`'s exported functions, never on Veramo directly
- `FederationTransport` interface + loopback implementation (`src/federation/`)

**Verified live against a real database — all 4 current test files, 18/18 tests passing:**
- `test/did.test.ts` — did:web construction/resolution-URL math, key generation + DID document shape, local-DB resolution, resolution failure returns `null` (not a thrown network error — see "Real bugs found" below), and a genuine HTTP round-trip against the same serving code the production route uses
- `test/vc.test.ts` — issue → verify round-trip, tampered-JWT rejection, and expiration — this time genuinely enforced by `jose` natively (see below), not worked around at the application layer the way Veramo's gap required
- `test/capabilities.test.ts` — DB-backed capability grant issue → verify → revoke lifecycle, wrong-capability rejection, unknown-credential rejection
- `test/mcp.test.ts` — `whoami`/`list_capabilities` over a real `McpServer` via `InMemoryTransport`, capability-gating allow/deny

Postgres runs via `docker-compose.yml` at the repo root (`pgvector/pgvector:pg16`, published on host port **5433**, deliberately not 5432 — avoids any collision with v1 (`fieldops-system`)'s own postgres container or anything else already bound to the host's default Postgres port):
```bash
docker compose up -d
npm run migrate
npm run sync:policy   # after setting reviewed_by/reviewed_at in policy/sovereignty_tiers.yaml
npm test
```

Confirmed clean: every test file's `afterAll` cleanup leaves zero residual rows in `nodes`/`keys`/`capability_grants`/`verifiable_credentials`.

`npm test` at the repo root will also pick up `vendor/openconstructionerp`'s own (large, unrelated, jsdom-dependent) test suite unless scoped — `vitest.config.ts` sets `include: ["test/**/*.test.ts"]` / `exclude: ["vendor/**", ...]` specifically to prevent that.

## Real bugs found and fixed (kept as a record across both identity-stack builds)

**In the current did:web/JWT-VC implementation:**

1. **`resolveDid` didn't catch a DNS/network failure**, only an HTTP-level "not ok" response — a nonexistent domain threw `TypeError: fetch failed` (`ENOTFOUND`) straight out of the function instead of returning `null` the way a 404 does. A resolution failure is exactly as legitimate an "unknown issuer" outcome as a 404; fixed by wrapping the fetch in a try/catch. Found by the very first test that exercised a genuinely non-existent domain, not by inspection.

**In the earlier Veramo-based implementation** (retained for the record — these bugs are real, instructive, and were fixed in that code before it was replaced; they don't apply to the current implementation, which doesn't use `didwebvh-ts`, `Multikey`, or `@veramo/credential-jwt` at all):

2. `createDID`/`resolveDID`/`resolveDIDFromLog` in `didwebvh-ts` both required a working `verifier`, not just a `signer` — the original code only ever passed a signer, and would have thrown `"Verifier implementation is required"` on the first real resolution.
3. A `Multikey`-typed verification method's `publicKeyMultibase` needed a 2-byte multicodec prefix (`0xed01` for Ed25519) before multibase-encoding, not just the raw public key bytes — every DID created before the fix failed `didwebvh-ts`'s own log validation.
4. `@veramo/credential-jwt` 7.0.0's `verifyCredential` did not enforce JWT expiration on its own, `policies: { expirationDate: true }` notwithstanding — reproduced directly with a hand-built expired JWT-VC that still verified as `true`. Worth noting since it's a genuine point of comparison: `jose`'s `jwtVerify` in the current implementation enforces `exp` natively, confirmed by `test/vc.test.ts`'s expiration test, no application-level workaround needed this time.
5. Veramo's `CredentialPlugin` required an explicit JWT credential provider passed to its constructor — the zero-argument form didn't exist.

## Technology decisions

See the approved plan for the original reasoning; the DID/VC entries below supersede it per the explicit instruction to drop Veramo.

- **DID method**: `did:web` (not `did:webvh`) — chosen for simplicity over `did:webvh`'s hash-chained key-rotation history, by explicit instruction. Resolves over plain HTTPS, same trust model as the domain this system already runs behind. Used for **both** the node's own identity (bare-domain form) and every agent identity (path-based `did:web:<domain>:agents:<role>` sub-DIDs) — a single resolution mechanism for everything, rather than mixing `did:web`/`did:webvh` (node) with `did:key` (agents) the way the Veramo-based design did.
- **VC library**: none — a from-scratch JWT-VC implementation (`src/identity/vc.ts`). `jose` supplies only the underlying JWS/JWT mechanics (RFC 7515/7519: sign, verify, encode, decode) — it is not a DID/VC framework and has no opinion on DID methods or credential shapes; both of those are this project's own code.
- **Key management**: Node's native `crypto`/Web Crypto Ed25519 support (via `jose.generateKeyPair('EdDSA', { crv: 'Ed25519' })`), keys stored as JWKs in a new Postgres `keys` table (`src/db/migrations/0005_keys.sql`) — no external KMS, no Veramo key-manager abstraction.
- **MCP framework**: the official `@modelcontextprotocol` TypeScript SDK — `@modelcontextprotocol/server` (v2, current spec generation), `/client` for testing, `@modelcontextprotocol/node`'s `toNodeHandler` for the Streamable HTTP transport's plain-Node wiring. Unaffected by the identity-stack swap.
- **Capability layer**: a custom JWT-based capability-grant model (`CapabilityGrant` JWTs + a Postgres `capability_grants` index), rather than a full UCAN implementation — simpler to get genuinely correct in Phase 1, revisit UCAN specifically if delegation chains (not just direct node→agent grants) become necessary.
- **Backend**: Node/TypeScript (the MCP SDK, `jose`, and OpenClaw's plugin ecosystem are all TS-native).
- **Database**: Postgres, no separate graph DB. pgvector for the future knowledge/RAG layer is deferred to Phase 2+ (no domain knowledge base exists yet to index).
- **`zod` pinned to `^4.4.3`, not `3.x`** — this MCP SDK generation's `registerTool` expects Zod's native Standard Schema V1 support (specifically `jsonSchema` on the schema's `~standard` props), which only zod v4 implements. Passing a zod v3 schema fails both of `registerTool`'s overloads. (`did-resolver`'s version-pinning note from the Veramo era no longer applies — that package was removed entirely.)

## D-Central-native architecture layers

- **Node identity**: one bare-domain `did:web` per deployment (e.g. `did:web:id.dcentral-fieldops.local`) — root of trust issuing capability JWTs to agent DIDs.
- **Agent identity**: each distinct agent role gets its own path-based `did:web` sub-DID (e.g. `did:web:id.dcentral-fieldops.local:agents:crew-dispatch`), holding a capability JWT from the node DID stating its capability tier and capability set.
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

- **Private key material is stored unencrypted** (`keys.private_jwk` is a plain JWK in Postgres) — durable now (an improvement over Veramo's in-memory stores), but not encrypted at rest. Envelope encryption or an external KMS is real follow-up work, not done here. The domain data this system actually cares about long-term (`capability_grants`, `nodes`, `agent_identities`) was already in real Postgres either way.
- **No key rotation implemented** — `did.ts`/`keys.ts` only cover create/resolve/delete for a DID's single key; rotating a node's or agent's key (issuing a new one, updating the served DID document, handling credentials signed under the old key) is real future work.
- **`did:web` resolution has only been tested against a real HTTP server serving the exact same route-handler code the production transport uses (`test/did.test.ts`'s HTTP round-trip test) — never against the *actual* production `mcp:http` process, and never over real HTTPS** (the test server is plain HTTP on an ephemeral local port). Needs a real domain decision (see "Open decisions" below) before that's testable end-to-end.
- Same as before: **the sovereignty-tier policy has never actually been reviewed** — this is the one gap that hasn't changed.

## Open decisions (unblocked from Phase 1, real before Phase 2)

1. Exact hosting device for the eventual deployment (Pi 5 vs. mini-PC vs. eventual VPS — VPS would need an explicit sovereignty-tier exception, not a default).
2. Domain for the node's `did:web` — under `sodboysltd.org` (the v1 client-facing domain) or a separate D-Central-branded domain. Blocks real end-to-end network-resolution testing against the actual production transport.
3. Local vs. external embedding model for pgvector, once a knowledge base exists to embed.
4. ~~Dashboard as an MCP client itself vs. a thin REST façade~~ — **decided**, see "Frontend" below: a full React SPA naturally consumes a REST/JSON API, not MCP-over-HTTP in-browser. A thin REST façade in front of the same MCP tool implementations is now the plan, not just a lean.
5. What v1 data is worth migrating vs. re-bootstrapping fresh, in the eventual Phase 4 cutover.
6. **Review and approve `policy/sovereignty_tiers.yaml`** — currently unreviewed, which is itself a decision that needs making, not deferring indefinitely.

## Frontend

Decided by explicit instruction, not the default this repo would otherwise have arrived at: the dashboard reuses [OpenConstructionERP](https://github.com/datadrivenconstruction/OpenConstructionERP)'s frontend rather than being built from scratch. Vendored as a git submodule at `vendor/openconstructionerp` (the *whole* upstream monorepo — it has its own `backend/`, `modules/`, `services/`, etc. alongside `frontend/`; only the `frontend/` subdirectory is actually used here). Submodule, not a squashed copy, specifically so its own `LICENSE`/`NOTICE`/`CONTRIBUTORS.md` stay intact and separately trackable against upstream — that matters for the point below, not just for pulling updates.

**License, stated plainly since it has real teeth**: OpenConstructionERP is AGPL-3.0. Confirmed and accepted directly, not a default — see the instruction that added this. The concrete mechanism, so "accepted" means the actual thing and not a vaguer one: AGPL-3.0's network-use clause (§13) means that if this system is modified and made available to users over a network (which a live FieldOps deployment is, by definition), the complete corresponding source of the *combined work* must be offered to every user who interacts with it — not just to someone who receives a distributed copy. Depending on how tightly the frontend and this system's own backend end up integrated (a separate REST API consumed over HTTP is the safer shape; statically linking or bundling code together is not), this plausibly extends the AGPL obligation to more than just `vendor/openconstructionerp/frontend/`'s own files. Two things worth knowing, found while vendoring, not previously flagged: OpenConstructionERP ships a `COMMERCIAL-LICENSE.md` — a paid non-AGPL license option exists from the upstream project if the AGPL obligation ever conflicts with the licensing/franchise business direction discussed for this system (see the wider planning history); and the vendored repo is a substantially more capable frontend than earlier design research assumed — React 18 + TypeScript + Vite, but also TanStack Query, AG Grid, MapLibre GL, Cesium (3D/geospatial), react-i18next, react-router-dom v7, not the smaller React/Tailwind/Recharts/Zustand stack previously described.

**Not yet done, real follow-up work**: actually wiring `vendor/openconstructionerp/frontend/` to this system's backend. It's a large, general-purpose construction-ERP UI (project/estimating/BIM/procurement workflows) that needs real adaptation to FieldOps' actual domain (dispatch, crew, sites, checkouts, exceptions) — not just an API base URL pointed at a new backend. Concretely: a thin REST façade needs to sit in front of the MCP tool implementations for the browser to call (see decision #4 above), the nav/routing needs cutting down to FieldOps' actual screens, and auth needs a real design (this system's capability-VC model is agent-to-agent, not a browser session model — the dashboard needs its own login story, not a repurposed agent DID). None of this is started.
