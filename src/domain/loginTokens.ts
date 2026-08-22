// Re-expressed from v1's login_tokens domain logic -- requirements
// baseline, not copied code. WhatsApp magic-link login for crew: mint a
// short-lived token (agent-issued, 15-minute expiry), redeeming it
// creates a real 30-day session. Not single-use -- used_at is a
// last-redemption marker only, bounded instead by a 10-minute issuance
// cooldown per crew member, same deliberate trade-off v1 makes.
import { createHash, randomBytes } from "node:crypto";
import { pool } from "../db/pool.js";
import { createSession } from "./sessions.js";

const TOKEN_TTL_MINUTES = 15;
const ISSUANCE_COOLDOWN_MINUTES = 10;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type MintLoginTokenResult = { ok: true; token: string; expiresAt: Date } | { ok: false; reason: "cooldown_active" };

export async function mintLoginToken(crewMemberId: string): Promise<MintLoginTokenResult> {
  const recent = await pool.query(
    `SELECT 1 FROM login_tokens WHERE crew_member_id = $1 AND created_at > now() - ($2 || ' minutes')::interval LIMIT 1`,
    [crewMemberId, ISSUANCE_COOLDOWN_MINUTES],
  );
  if (recent.rows[0]) return { ok: false, reason: "cooldown_active" };

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000);
  await pool.query(
    "INSERT INTO login_tokens (token_hash, crew_member_id, expires_at) VALUES ($1, $2, $3)",
    [hashToken(token), crewMemberId, expiresAt],
  );
  return { ok: true, token, expiresAt };
}

export type RedeemLoginTokenResult = { ok: true; sessionToken: string; crewMemberId: string } | { ok: false; reason: "invalid_or_expired" };

export async function redeemLoginToken(token: string): Promise<RedeemLoginTokenResult> {
  const tokenHash = hashToken(token);
  const result = await pool.query(
    "UPDATE login_tokens SET used_at = now() WHERE token_hash = $1 AND expires_at > now() RETURNING crew_member_id",
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, reason: "invalid_or_expired" };

  const { token: sessionToken } = await createSession({ crewMemberId: row.crew_member_id });
  return { ok: true, sessionToken, crewMemberId: row.crew_member_id };
}
