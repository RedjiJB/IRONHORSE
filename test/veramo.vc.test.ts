// Phase 1 verification item: "a node-issued capability VC for a test
// agent DID verifies correctly; a tampered/expired one is correctly
// rejected." No Postgres needed -- pure Veramo issue/verify.
import { describe, expect, it } from "vitest";
import { veramoAgent } from "../src/identity/veramoAgent.js";

describe("Verifiable Credential issue/verify", () => {
  it("issues and verifies a CapabilityGrant VC", async () => {
    const issuer = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });

    const vc = await veramoAgent.createVerifiableCredential({
      proofFormat: "jwt",
      credential: {
        issuer: { id: issuer.did },
        credentialSubject: { id: subject.did, capability: "mcp:tool:whoami", tier: 2 },
        type: ["VerifiableCredential", "CapabilityGrant"],
        issuanceDate: new Date().toISOString(),
      },
    });

    const verification = await veramoAgent.verifyCredential({ credential: vc });
    expect(verification.verified).toBe(true);
  });

  it("rejects a tampered JWT", async () => {
    const issuer = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });

    const vc = await veramoAgent.createVerifiableCredential({
      proofFormat: "jwt",
      credential: {
        issuer: { id: issuer.did },
        credentialSubject: { id: subject.did, capability: "mcp:tool:whoami", tier: 2 },
        type: ["VerifiableCredential", "CapabilityGrant"],
        issuanceDate: new Date().toISOString(),
      },
    });

    const jwt = typeof vc.proof.jwt === "string" ? vc.proof.jwt : String(vc.proof.jwt);
    // Flip one character in the signature segment (last dot-segment of a JWT).
    const parts = jwt.split(".");
    const lastChar = parts[2]?.at(-1);
    const flipped = lastChar === "A" ? "B" : "A";
    parts[2] = (parts[2] ?? "").slice(0, -1) + flipped;
    const tampered = parts.join(".");

    const verification = await veramoAgent.verifyCredential({
      credential: tampered as unknown as typeof vc,
    });
    expect(verification.verified).toBe(false);
  });

  // NOT a bug in this codebase -- a documented, empirically-confirmed
  // upstream gap. @veramo/credential-jwt 7.0.0's verifyCredential does not
  // reject an already-expired JWT-VC by itself, `policies.expirationDate:
  // true` notwithstanding (reproduced directly: a JWT with `exp` 30s in
  // the past still verified as `true`). This test pins that real behavior
  // so a future dependency upgrade that fixes it is *noticed*, not missed.
  // The actual enforcement this system relies on is the explicit
  // application-level check in src/identity/capabilities.ts's
  // verifyPresentedCapability -- see test/capabilities.test.ts for the
  // test that exercises the real, enforced path.
  it("does NOT reject an already-expired VC on its own (known upstream gap, worked around at the application layer)", async () => {
    const issuer = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });

    const vc = await veramoAgent.createVerifiableCredential({
      proofFormat: "jwt",
      credential: {
        issuer: { id: issuer.did },
        credentialSubject: { id: subject.did, capability: "mcp:tool:whoami", tier: 2 },
        type: ["VerifiableCredential", "CapabilityGrant"],
        issuanceDate: new Date(Date.now() - 60_000).toISOString(),
        expirationDate: new Date(Date.now() - 30_000).toISOString(),
      },
    });

    const verification = await veramoAgent.verifyCredential({
      credential: vc,
      policies: { expirationDate: true },
    });
    expect(verification.verified).toBe(true);
  });
});
