-- The root identity layer. A "node" is one D-Central deployment (today,
-- exactly one row -- this deployment itself). Kept as a real table rather
-- than a config value specifically so a future federated peer is an
-- additive row, not a schema change (see docs/ARCHITECTURE.md's federation
-- section).
CREATE TABLE nodes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  did          TEXT NOT NULL UNIQUE, -- did:webvh:... for this node's own identity
  display_name TEXT NOT NULL,
  is_self      BOOLEAN NOT NULL DEFAULT false, -- exactly one TRUE row: this node
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforced in application code at insert time (Postgres has no native
-- "exactly one TRUE" constraint without a partial unique index trick);
-- the partial unique index below is the actual enforcement mechanism.
CREATE UNIQUE INDEX nodes_single_self_idx ON nodes (is_self) WHERE is_self = true;

-- One row per distinct agent role (crew-facing dispatch, exceptions/
-- escalation, admin/diagnostic, future federation agent, ...). Each holds
-- its own did:key -- see docs/ARCHITECTURE.md "Agent identity" for why
-- this is did:key (ephemeral/no-rotation-needed) rather than did:webvh
-- (the node's own long-lived identity).
CREATE TABLE agent_identities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id      UUID NOT NULL REFERENCES nodes(id),
  did          TEXT NOT NULL UNIQUE,
  role         TEXT NOT NULL, -- e.g. 'crew-dispatch', 'exceptions', 'admin', 'federation'
  display_name TEXT NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ
);

CREATE INDEX agent_identities_node_id_idx ON agent_identities (node_id);
