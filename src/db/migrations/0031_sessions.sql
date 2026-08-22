-- Re-expressed from v1's `sessions` table -- requirements baseline, not
-- copied code. Cookie+DB-row auth, not JWT -- a random 32-byte token is
-- issued once and shown to the caller exactly once; only its SHA-256
-- hash is ever persisted (token_hash PRIMARY KEY), mirroring the
-- never-store-plaintext convention password_hash already follows.
-- Dual-path: exactly one of user_id/crew_member_id set -- the same table
-- backs a dashboard password-login session and a WhatsApp magic-link
-- crew session (see 0032_login_tokens.sql), same as v1.
CREATE TABLE sessions (
  token_hash      TEXT PRIMARY KEY,
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  crew_member_id  UUID REFERENCES crew_members(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  CONSTRAINT sessions_exactly_one_identity CHECK ((user_id IS NOT NULL) != (crew_member_id IS NOT NULL))
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_crew_member_id_idx ON sessions (crew_member_id);
