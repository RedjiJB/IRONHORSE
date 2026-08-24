// Real security-audit gap, fixed: nothing previously stopped a sustained
// automated attempt against POST /login. Tracked by normalized email only
// (not IP) -- Cloudflare already fronts this traffic and is the natural
// place for IP-based/volumetric rate-limiting if that's added later; this
// closes the specific gap a distributed attack would slip through, a
// targeted attempt against one known account regardless of source IP.
// Every attempt is logged (success or failure) rather than a running
// counter column, same sliding-window shape as loginTokens.ts's issuance
// cooldown -- old failures age out of the window on their own, no reset
// logic needed on a successful login.
import { pool } from "../db/pool.js";

const LOCKOUT_WINDOW_MINUTES = 15;
const MAX_FAILED_ATTEMPTS = 5;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function isLoginLocked(email: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS n FROM login_attempts
     WHERE email = $1 AND success = false AND created_at > now() - ($2 || ' minutes')::interval`,
    [normalizeEmail(email), LOCKOUT_WINDOW_MINUTES],
  );
  return (result.rows[0].n as number) >= MAX_FAILED_ATTEMPTS;
}

export async function recordLoginAttempt(email: string, success: boolean): Promise<void> {
  await pool.query("INSERT INTO login_attempts (email, success) VALUES ($1, $2)", [normalizeEmail(email), success]);
}
