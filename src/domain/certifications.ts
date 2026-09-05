// Compliance-dashboard basics (FEATURES.md §7). Deliberately not gating
// anything yet -- see 0012_guard_certifications.sql's comment and
// DOMAIN-DESIGN.md §5: the resolved cert-gating design needs a posts
// concept this domain doesn't have (Phase 2). This module only tracks
// what a guard holds and surfaces what's expiring soon or already expired
// -- visibility, not enforcement.
import { pool } from "../db/pool.js";
import { listRequiredCertifications } from "./posts.js";

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

export type PostComplianceCheck = { missing: string[]; expired: string[] };

// Soft-flag only, per DOMAIN-DESIGN.md §5's resolved decision -- this
// never blocks anything, it just answers "what's wrong, if anything" for
// a caller (assignShift's caller, a supervisor UI) to decide what to do
// with. A cert type required by the post but entirely absent from the
// guard's records is "missing"; one that exists but expires before
// asOfDate is "expired" -- two different states, same instinct this
// module already applies to expiring-soon vs. already-expired.
// node-postgres hands back a DATE column as a JS Date object at runtime
// despite guard_certifications.expires_at being typed as string here --
// the same lesson dcentral-fieldops's fieldReports.ts documents for its
// own report_date column. Comparing a Date object to asOfDate (a plain
// string) with >= silently coerces the Date to a number and the string to
// NaN, so the comparison is always false -- every cert looked expired
// regardless of its real date. Normalize to a date-only string first.
function toDateOnlyString(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

export async function checkGuardPostCompliance(guardId: string, postId: string, asOfDate: string): Promise<PostComplianceCheck> {
  const required = await listRequiredCertifications(postId);
  if (required.length === 0) return { missing: [], expired: [] };

  const held = await pool.query(
    "SELECT cert_type, expires_at FROM guard_certifications WHERE guard_id = $1",
    [guardId],
  );
  const heldByCertType = new Map<string, string[]>();
  for (const row of held.rows as { cert_type: string; expires_at: string | Date }[]) {
    const list = heldByCertType.get(row.cert_type) ?? [];
    list.push(toDateOnlyString(row.expires_at));
    heldByCertType.set(row.cert_type, list);
  }

  const missing: string[] = [];
  const expired: string[] = [];
  for (const req of required) {
    const expiryDates = heldByCertType.get(req.cert_type);
    if (!expiryDates || expiryDates.length === 0) {
      missing.push(req.cert_type);
      continue;
    }
    // A guard may hold more than one cert of the same type over time
    // (renewed) -- only flag "expired" if every held instance is expired
    // as of the given date, not just the first one found.
    const hasCurrent = expiryDates.some((expiresAt) => expiresAt >= asOfDate);
    if (!hasCurrent) expired.push(req.cert_type);
  }

  return { missing, expired };
}
