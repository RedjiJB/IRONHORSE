// Re-expressed from v1's sessions domain logic -- requirements baseline,
// not copied code. A random 32-byte token is generated and returned to
// the caller exactly once; only its SHA-256 hash is ever persisted, same
// never-store-plaintext convention as password_hash. Dual-path: exactly
// one of userId/crewMemberId -- the same table backs a dashboard
// password-login session and a WhatsApp magic-link crew session (see
// src/domain/loginTokens.ts).
import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";

const DEFAULT_SESSION_DAYS = 30;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionIdentity = { type: "user"; userId: string } | { type: "crew"; crewMemberId: string };

export async function createSession(identity: { userId?: string; crewMemberId?: string }, expiresInDays = DEFAULT_SESSION_DAYS): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO sessions (token_hash, user_id, crew_member_id, expires_at) VALUES ($1, $2, $3, $4)`,
    [tokenHash, identity.userId ?? null, identity.crewMemberId ?? null, expiresAt],
  );
  return { token, expiresAt };
}

export async function resolveSession(token: string): Promise<SessionIdentity | null> {
  const tokenHash = hashToken(token);
  const result = await pool.query(
    "SELECT user_id, crew_member_id FROM sessions WHERE token_hash = $1 AND expires_at > now()",
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return null;
  return row.user_id ? { type: "user", userId: row.user_id } : { type: "crew", crewMemberId: row.crew_member_id };
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
}
