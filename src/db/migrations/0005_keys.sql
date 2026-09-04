-- Replaces Veramo's in-memory key store with real, queryable persistence.
-- Public/private key material is stored as JWKs (Ed25519/EdDSA) -- flagged,
-- not hidden: no at-rest encryption yet for private_jwk. That's real
-- follow-up work (envelope encryption or an external KMS), same honesty
-- pattern as every other flagged gap in this project, just inverted from
-- Veramo's version of the gap (that was durable-vs-not; this is
-- encrypted-vs-not).
CREATE TABLE keys (
  did          TEXT PRIMARY KEY,
  public_jwk   JSONB NOT NULL,
  private_jwk  JSONB NOT NULL,
  algorithm    TEXT NOT NULL DEFAULT 'EdDSA',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
