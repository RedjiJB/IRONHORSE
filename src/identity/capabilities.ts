// Issuing and verifying "CapabilityGrant" VCs -- the cryptographic half of
// the capability-tier authorization model (see docs/ARCHITECTURE.md). The
// pool.query calls maintain the queryable capability_grants index
// alongside the raw signed VC in verifiable_credentials (see
// src/db/migrations/0002_credentials_and_capabilities.sql for why both
// tables exist and which one is actually trusted).
import type { VerifiableCredential } from "@veramo/core-types";
import { pool } from "../db/pool.js";
import { veramoAgent } from "./veramoAgent.js";

export type CapabilityTier = 0 | 1 | 2 | 3 | 4;

export type IssueCapabilityGrantArgs = {
  issuerDid: string;
  issuerNodeId: string;
  subjectDid: string;
  capability: string;
  tier: CapabilityTier;
  expiresAt?: Date;
};

export async function issueCapabilityGrant(args: IssueCapabilityGrantArgs): Promise<{
  credentialId: string;
  grantId: string;
  jwt: string;
}> {
  const issuedAt = new Date();
  const vc = await veramoAgent.createVerifiableCredential({
    proofFormat: "jwt",
    credential: {
      issuer: { id: args.issuerDid },
      credentialSubject: {
        id: args.subjectDid,
        capability: args.capability,
        tier: args.tier,
      },
      type: ["VerifiableCredential", "CapabilityGrant"],
      issuanceDate: issuedAt.toISOString(),
      ...(args.expiresAt ? { expirationDate: args.expiresAt.toISOString() } : {}),
    },
  });

  const jwt = typeof vc.proof.jwt === "string" ? vc.proof.jwt : String(vc.proof.jwt);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const credRow = await client.query(
      `INSERT INTO verifiable_credentials (jwt, issuer_did, subject_did, credential_type, issued_at, expires_at)
       VALUES ($1, $2, $3, 'CapabilityGrant', $4, $5)
       RETURNING id`,
      [jwt, args.issuerDid, args.subjectDid, issuedAt, args.expiresAt ?? null],
    );
    const credentialId = credRow.rows[0].id as string;

    const grantRow = await client.query(
      `INSERT INTO capability_grants (credential_id, subject_did, issuer_node_id, capability, tier, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [credentialId, args.subjectDid, args.issuerNodeId, args.capability, args.tier, args.expiresAt ?? null],
    );
    await client.query("COMMIT");
    return { credentialId, grantId: grantRow.rows[0].id as string, jwt };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export type CapabilityCheckResult =
  | { allowed: true; tier: CapabilityTier; subjectDid: string }
  | {
      allowed: false;
      reason: "signature_invalid" | "wrong_credential_type" | "not_found_or_revoked" | "expired" | "wrong_capability" | "insufficient_tier";
    };

// The actual authorization check the MCP capability-tier middleware calls
// before allowing a gated tool invocation. The caller presents their own
// CapabilityGrant VC (as a tool argument -- see src/mcp/middleware.ts for
// why this is argument-based rather than HTTP-bearer-only: it has to work
// identically over stdio, which has no HTTP layer to carry a bearer token).
//
// Verification order matters: cryptographic signature first (this is the
// only step that actually proves the claims weren't tampered with), *then*
// the DB lookup -- purely to check revocation, which is inherently a
// DB-side concept a JWT signature can never reflect on its own. The DB
// row is never trusted for anything the signature should have proven.
export async function verifyPresentedCapability(
  presentedJwt: string,
  capability: string,
  minimumTier: CapabilityTier,
): Promise<CapabilityCheckResult> {
  const verification = await veramoAgent.verifyCredential({
    credential: presentedJwt as unknown as VerifiableCredential,
    policies: { expirationDate: true },
  });
  if (!verification.verified) return { allowed: false, reason: "signature_invalid" };

  const vc = verification.verifiableCredential as unknown as {
    type?: string[];
    expirationDate?: string;
    credentialSubject: { id?: string; capability?: string; tier?: number };
  };
  if (!vc.type?.includes("CapabilityGrant")) return { allowed: false, reason: "wrong_credential_type" };

  // Explicit application-level check, not just belt-and-suspenders:
  // confirmed empirically during Phase 1 testing that @veramo/credential-jwt
  // 7.0.0's verifyCredential does NOT reject an already-expired JWT-VC on
  // its own, `policies.expirationDate: true` above notwithstanding -- a
  // hand-built JWT with `exp` 30s in the past still verified as `true` in
  // a direct reproduction. Filed as a real, load-bearing gap in that
  // dependency, not assumed fixed -- this check is what actually enforces
  // expiry until/unless that's confirmed resolved upstream.
  if (vc.expirationDate && new Date(vc.expirationDate) < new Date()) {
    return { allowed: false, reason: "signature_invalid" };
  }

  const subjectDid = vc.credentialSubject.id;
  if (!subjectDid) return { allowed: false, reason: "signature_invalid" };

  const dbRow = await pool.query(
    `SELECT cg.tier, cg.expires_at
     FROM capability_grants cg
     JOIN verifiable_credentials vc ON vc.id = cg.credential_id
     WHERE vc.jwt = $1 AND cg.revoked_at IS NULL AND vc.revoked_at IS NULL`,
    [presentedJwt],
  );
  const grant = dbRow.rows[0];
  if (!grant) return { allowed: false, reason: "not_found_or_revoked" };
  if (grant.expires_at && new Date(grant.expires_at) < new Date()) {
    return { allowed: false, reason: "expired" };
  }

  if (vc.credentialSubject.capability !== capability && vc.credentialSubject.capability !== "*") {
    return { allowed: false, reason: "wrong_capability" };
  }
  if ((grant.tier as CapabilityTier) < minimumTier) {
    return { allowed: false, reason: "insufficient_tier" };
  }

  return { allowed: true, tier: grant.tier as CapabilityTier, subjectDid };
}

export async function revokeCapabilityGrant(grantId: string): Promise<void> {
  await pool.query("UPDATE capability_grants SET revoked_at = now() WHERE id = $1", [grantId]);
}
