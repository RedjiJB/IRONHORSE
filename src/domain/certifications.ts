// Compliance-dashboard basics (FEATURES.md §7). Deliberately not gating
// anything yet -- see 0012_guard_certifications.sql's comment and
// DOMAIN-DESIGN.md §5: the resolved cert-gating design needs a posts
// concept this domain doesn't have (Phase 2). This module only tracks
// what a guard holds and surfaces what's expiring soon or already expired
// -- visibility, not enforcement.
import { pool } from "../db/pool.js";

export type GuardCertification = {
  id: string;
  guard_id: string;
  cert_type: string;
  issued_at: string | null;
  expires_at: string;
  created_at: string;
};

export async function addCertification(args: {
  guardId: string;
  certType: string;
  issuedAt?: string;
  expiresAt: string;
}): Promise<GuardCertification> {
  const result = await pool.query(
    `INSERT INTO guard_certifications (guard_id, cert_type, issued_at, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [args.guardId, args.certType, args.issuedAt ?? null, args.expiresAt],
  );
  return result.rows[0] as GuardCertification;
}

export async function listCertificationsForGuard(guardId: string): Promise<GuardCertification[]> {
  const result = await pool.query(
    "SELECT * FROM guard_certifications WHERE guard_id = $1 ORDER BY expires_at",
    [guardId],
  );
  return result.rows as GuardCertification[];
}

export type CertificationWithGuardName = GuardCertification & { guard_name: string };

// "Expiring soon" is within the next N days and not yet expired --
// already-expired certs are a distinct, more urgent state (see
// listExpiredCertifications), never folded into the same list, same
// instinct DOMAIN-DESIGN.md §5 already applies to hard-block-vs-soft-flag
// (don't collapse two genuinely different states into one).
export async function listExpiringSoonCertifications(daysAhead: number): Promise<CertificationWithGuardName[]> {
  const result = await pool.query(
    `SELECT c.*, g.name AS guard_name
     FROM guard_certifications c
     JOIN guards g ON g.id = c.guard_id
     WHERE c.expires_at >= CURRENT_DATE AND c.expires_at < CURRENT_DATE + ($1 || ' days')::interval
     ORDER BY c.expires_at`,
    [daysAhead],
  );
  return result.rows as CertificationWithGuardName[];
}

export async function listExpiredCertifications(): Promise<CertificationWithGuardName[]> {
  const result = await pool.query(
    `SELECT c.*, g.name AS guard_name
     FROM guard_certifications c
     JOIN guards g ON g.id = c.guard_id
     WHERE c.expires_at < CURRENT_DATE
     ORDER BY c.expires_at DESC`,
  );
  return result.rows as CertificationWithGuardName[];
}
