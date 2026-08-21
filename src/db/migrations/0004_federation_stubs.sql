-- Federation-ready, genuinely single-node: real schemas that function
-- correctly at N=1, not placeholders. See docs/ARCHITECTURE.md's
-- "Federation-ready, genuinely single-node" section -- a second node later
-- is additive rows here, not a migration.

-- Known peers. Empty except implicitly "self" (see nodes.is_self) until a
-- second real D-Central node exists.
CREATE TABLE federation_peers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id      UUID NOT NULL REFERENCES nodes(id),
  transport    TEXT NOT NULL DEFAULT 'loopback', -- see src/federation/FederationTransport.ts
  endpoint     TEXT, -- NULL for the loopback transport
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DAO governance / capability-grant voting. Functions correctly at
-- quorum-of-one: a single-node deployment's own proposal, voted on by
-- itself, is a degenerate but real instance of the same code path a
-- second node would use -- not a different mechanism bolted on later.
CREATE TABLE federation_proposals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposer_node_id UUID NOT NULL REFERENCES nodes(id),
  kind          TEXT NOT NULL, -- e.g. 'capability_grant', 'policy_change'
  payload       JSONB NOT NULL,
  quorum_required SMALLINT NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'withdrawn')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at   TIMESTAMPTZ
);

CREATE TABLE federation_votes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID NOT NULL REFERENCES federation_proposals(id),
  voter_node_id UUID NOT NULL REFERENCES nodes(id),
  vote         TEXT NOT NULL CHECK (vote IN ('yes', 'no', 'abstain')),
  cast_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, voter_node_id)
);

-- D-Credit cost-accounting ledger -- extends v1 (fieldops-system)'s
-- model_usage_daily shape into a DID-keyed ledger, per docs/ARCHITECTURE.md.
-- origin_node_id is always this node's own id today; the column exists so
-- a shared cooperative ledger across nodes is additive later.
CREATE TABLE dcredit_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_node_id  UUID NOT NULL REFERENCES nodes(id),
  actor_did       TEXT NOT NULL, -- which agent identity incurred the cost
  usage_date      DATE NOT NULL,
  provider        TEXT NOT NULL, -- e.g. 'deepseek', 'anthropic'
  model           TEXT NOT NULL,
  input_tokens    BIGINT NOT NULL DEFAULT 0,
  output_tokens   BIGINT NOT NULL DEFAULT 0,
  cost_usd        NUMERIC(10, 4) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX dcredit_ledger_actor_did_usage_date_idx ON dcredit_ledger (actor_did, usage_date);
