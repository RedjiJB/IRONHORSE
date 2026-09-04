-- The raw, signed Verifiable Credential -- source of truth. jwt is the
-- actual signed artifact; everything else here is denormalized from its
-- claims purely for querying, never trusted on its own. The MCP capability
-- middleware re-verifies the jwt's signature (src/identity/vc.ts) on every check that
-- gates a mutating action -- this table existing doesn't mean a grant is
-- valid, only that it was issued and not (yet) revoked.
CREATE TABLE verifiable_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jwt           TEXT NOT NULL,
  issuer_did    TEXT NOT NULL,
  subject_did   TEXT NOT NULL,
  credential_type TEXT NOT NULL, -- e.g. 'CapabilityGrant'
  issued_at     TIMESTAMPTZ NOT NULL,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX verifiable_credentials_subject_did_idx ON verifiable_credentials (subject_did);

-- Queryable, indexed view of what a capability-grant VC actually claims --
-- "does this agent DID hold tier >= N for this capability", answerable
-- with a fast lookup before falling through to the slower cryptographic
-- re-verification of the backing VC. One row per (subject, capability).
CREATE TABLE capability_grants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id     UUID NOT NULL REFERENCES verifiable_credentials(id),
  subject_did       TEXT NOT NULL, -- the agent DID this grant is for
  issuer_node_id    UUID NOT NULL REFERENCES nodes(id), -- origin_did equivalent -- see docs/ARCHITECTURE.md federation note
  capability        TEXT NOT NULL, -- e.g. 'mcp:tool:whoami', 'mcp:tool:*'
  tier              SMALLINT NOT NULL CHECK (tier BETWEEN 0 AND 4), -- 0 read-only .. 4 admin/self-modifying
  expires_at        TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX capability_grants_subject_did_idx ON capability_grants (subject_did) WHERE revoked_at IS NULL;
CREATE INDEX capability_grants_issuer_node_id_idx ON capability_grants (issuer_node_id);
