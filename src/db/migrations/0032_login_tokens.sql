-- Re-expressed from v1's `login_tokens` table -- requirements baseline,
-- not copied code. WhatsApp magic-link login for crew: a short-lived
-- token is minted (agent-issued, 15-minute expiry, 10-minute cooldown per
-- crew member -- enforced in src/domain/loginTokens.ts, not here),
-- redeeming it creates a real session row in the table above. Not
-- single-use, deliberately -- used_at is a last-redemption marker only,
-- not single-use-gating, same trade-off v1 makes (bounded by the
-- issuance cooldown instead of one-shot redemption).
CREATE TABLE login_tokens (
  token_hash      TEXT PRIMARY KEY,
  crew_member_id  UUID NOT NULL REFERENCES crew_members(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ
);

CREATE INDEX login_tokens_crew_member_id_idx ON login_tokens (crew_member_id, created_at DESC);
