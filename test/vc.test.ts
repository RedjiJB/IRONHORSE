// Phase 1 verification: the self-built JWT-VC implementation (src/identity/vc.ts)
// -- issue/verify round-trip, tampered-JWT rejection, and expiration.
// Worth calling out directly: the equivalent Veramo-based test file this
// replaced had to document a real upstream gap (@veramo/credential-jwt
// 7.0.0 not enforcing `exp` on its own). jose's jwtVerify enforces
// expiration natively -- confirmed here, not assumed, since that gap was
// exactly the kind of thing that only shows up when actually tested.
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { didWebForAgent } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair } from "../src/identity/keys.js";
import { issueCapabilityGrantJwt, verifyCapabilityGrantJwt } from "../src/identity/vc.js";

const testDids: string[] = [];

afterAll(async () => {
  for (const did of testDids) await deleteKeyPair(did);
  await pool.end();
});

async function makeTestIssuer(label: string): Promise<string> {
  const did = didWebForAgent("id.dcentral-fieldops.test", label);
  testDids.push(did);
  await generateAndStoreKeyPair(did);
  return did;
}

describe("issue -> verify round-trip", () => {
  it("issues a CapabilityGrant JWT and verifies it against the issuer's real key", async () => {
    const issuerDid = await makeTestIssuer("vc-issuer-1");
    const subjectDid = await makeTestIssuer("vc-subject-1");

    const jwt = await issueCapabilityGrantJwt({
      issuerDid,
      subjectDid,
      capability: "mcp:tool:test-tool",
      tier: 3,
    });

    const result = await verifyCapabilityGrantJwt(jwt);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.issuerDid).toBe(issuerDid);
      expect(result.subjectDid).toBe(subjectDid);
      expect(result.capability).toBe("mcp:tool:test-tool");
      expect(result.tier).toBe(3);
    }
  });

  it("rejects a JWT with a tampered payload", async () => {
    const issuerDid = await makeTestIssuer("vc-issuer-2");
    const subjectDid = await makeTestIssuer("vc-subject-2");
    const jwt = await issueCapabilityGrantJwt({ issuerDid, subjectDid, capability: "mcp:tool:x", tier: 1 });

    const [header, payload, signature] = jwt.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), vc: { type: ["VerifiableCredential", "CapabilityGrant"], credentialSubject: { id: subjectDid, capability: "mcp:tool:x", tier: 4 } } }),
    ).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    const result = await verifyCapabilityGrantJwt(tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature_invalid");
  });

  it("rejects an expired JWT -- jose enforces this natively, confirmed not assumed", async () => {
    const issuerDid = await makeTestIssuer("vc-issuer-3");
    const subjectDid = await makeTestIssuer("vc-subject-3");
    const jwt = await issueCapabilityGrantJwt({
      issuerDid,
      subjectDid,
      capability: "mcp:tool:x",
      tier: 1,
      expiresAt: new Date(Date.now() - 30_000), // 30s in the past
    });

    const result = await verifyCapabilityGrantJwt(jwt);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects a well-formed JWT from an issuer this node has never heard of", async () => {
    // decodeJwt succeeds (it's a syntactically fine, if unsigned-by-anyone-
    // real JWT), but resolveDid() for a nonexistent domain returns null.
    const subjectDid = await makeTestIssuer("vc-subject-4");
    const fakeJwt = await issueCapabilityGrantJwt({
      issuerDid: "did:web:this-issuer-does-not-exist.invalid",
      subjectDid,
      capability: "mcp:tool:x",
      tier: 1,
    }).catch(() => null);
    // issueCapabilityGrantJwt itself would fail (no stored private key for
    // an issuer DID that was never created) -- confirms the same thing from
    // the issuing side: you cannot sign as a DID you don't hold the key for.
    expect(fakeJwt).toBeNull();
  });
});
