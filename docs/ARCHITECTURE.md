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

**Written, not yet run** (blocked on local Postgres — see below):
- `test/capabilities.test.ts` — DB-backed capability grant issue → verify → revoke lifecycle, wrong-capability rejection, unknown-credential rejection
- `test/mcp.test.ts` — `whoami`/`list_capabilities` over a real `McpServer` via `InMemoryTransport`, capability-gating allow/deny

**Blocked this session**: Docker Desktop's GUI processes were running (`Responding: True`) but the daemon never accepted a connection through this environment's shell after 10+ minutes (`docker ps` timed out repeatedly). No native Postgres install exists on this machine either. The two DB-dependent test files above are believed correct (they follow the exact same patterns as the passing DB-free tests and exercise real, typechecked code paths) but have **not actually been run against a real database** — don't treat them as verified until they have been. Next session: get a Postgres reachable (fix Docker Desktop, or `docker run postgres` from a shell where the daemon actually responds, or a native install), then:
```bash
npm run migrate
npm run sync:policy   # after setting reviewed_by/reviewed_at in policy/sovereignty_tiers.yaml
npm test
```

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
4. Dashboard as an MCP client itself vs. a thin REST façade (current lean: REST façade).
5. What v1 data is worth migrating vs. re-bootstrapping fresh, in the eventual Phase 4 cutover.
6. **Review and approve `policy/sovereignty_tiers.yaml`** — currently unreviewed, which is itself a decision that needs making, not deferring indefinitely.
