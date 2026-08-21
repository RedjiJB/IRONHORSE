// Phase 1 verification item: "capability-tier middleware: a test agent DID
// with a Tier-1 VC is denied a Tier-3 tool call; a Tier-3 VC is allowed."
// Needs a real Postgres (see .env / DATABASE_URL) -- this is the one test
// file that exercises the actual DB-backed grant/revoke lifecycle, not
// just the cryptography.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { veramoAgent } from "../src/identity/veramoAgent.js";
import { issueCapabilityGrant, revokeCapabilityGrant, verifyPresentedCapability } from "../src/identity/capabilities.js";

let issuerDid: string;
let issuerNodeId: string;

beforeAll(async () => {
  const issuer = await veramoAgent.didManagerCreate({ provider: "did:key" });
  issuerDid = issuer.did;
  // is_self stays false -- this is an arbitrary test-fixture node, not the
  // one real "this deployment's own identity" row, which nodes_single_self_idx
  // enforces as a global singleton across every test file sharing this DB.
  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node', false) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;
});

afterAll(async () => {
  await pool.query("DELETE FROM capability_grants WHERE issuer_node_id = $1", [issuerNodeId]);
  await pool.query("DELETE FROM verifiable_credentials WHERE issuer_did = $1", [issuerDid]);
  await pool.query("DELETE FROM nodes WHERE id = $1", [issuerNodeId]);
  await pool.end();
});

describe("capability grant issue -> verify -> revoke lifecycle", () => {
  it("allows a call at or below the granted tier, denies above it", async () => {
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const { jwt } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:test-tool",
      tier: 3,
    });

    const okAtTier3 = await verifyPresentedCapability(jwt, "mcp:tool:test-tool", 3);
    expect(okAtTier3.allowed).toBe(true);

    const okAtTier1 = await verifyPresentedCapability(jwt, "mcp:tool:test-tool", 1);
    expect(okAtTier1.allowed).toBe(true);

    const deniedAtTier4 = await verifyPresentedCapability(jwt, "mcp:tool:test-tool", 4);
    expect(deniedAtTier4.allowed).toBe(false);
    if (!deniedAtTier4.allowed) expect(deniedAtTier4.reason).toBe("insufficient_tier");
  });

  it("denies a grant for the wrong capability name", async () => {
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const { jwt } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:only-this-one",
      tier: 3,
    });

    const result = await verifyPresentedCapability(jwt, "mcp:tool:something-else", 1);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("wrong_capability");
  });

  it("denies a revoked grant even though the underlying VC is still cryptographically valid", async () => {
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const { jwt, grantId } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:revocable",
      tier: 2,
    });

    expect((await verifyPresentedCapability(jwt, "mcp:tool:revocable", 2)).allowed).toBe(true);

    await revokeCapabilityGrant(grantId);

    const afterRevoke = await verifyPresentedCapability(jwt, "mcp:tool:revocable", 2);
    expect(afterRevoke.allowed).toBe(false);
    if (!afterRevoke.allowed) expect(afterRevoke.reason).toBe("not_found_or_revoked");

    // The signature itself is still perfectly valid -- confirms revocation
    // is genuinely a DB-side concept, not something the JWT can express.
    const rawVerify = await veramoAgent.verifyCredential({ credential: jwt as unknown as never });
    expect(rawVerify.verified).toBe(true);
  });

  it("denies an unissued/unknown credential", async () => {
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });
    // A well-formed VC signed by a real issuer, but never inserted into
    // capability_grants -- simulates a JWT that was never actually granted
    // through issueCapabilityGrant (e.g. a forged claim about a real DID).
    const vc = await veramoAgent.createVerifiableCredential({
      proofFormat: "jwt",
      credential: {
        issuer: { id: issuerDid },
        credentialSubject: { id: subject.did, capability: "mcp:tool:test-tool", tier: 4 },
        type: ["VerifiableCredential", "CapabilityGrant"],
        issuanceDate: new Date().toISOString(),
      },
    });
    const jwt = typeof vc.proof.jwt === "string" ? vc.proof.jwt : String(vc.proof.jwt);

    const result = await verifyPresentedCapability(jwt, "mcp:tool:test-tool", 1);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("not_found_or_revoked");
  });
});
