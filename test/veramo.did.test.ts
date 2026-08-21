// Phase 1 verification item: "veramo DID create/resolve/revoke round-trips
// correctly for both did:webvh and did:key." No Postgres needed -- purely
// Veramo/didwebvh-ts.
import { describe, expect, it } from "vitest";
import { veramoAgent } from "../src/identity/veramoAgent.js";
import {
  AbstractCrypto,
  createDID,
  multibaseEncode,
  MultibaseEncoding,
  prepareDataForSigning,
  resolveDIDFromLog,
} from "didwebvh-ts";
import { ed25519 } from "@noble/curves/ed25519.js";
import { ed25519Verifier } from "../src/identity/ed25519Verifier.js";

describe("did:key via Veramo", () => {
  it("creates and resolves a did:key identifier", async () => {
    const identifier = await veramoAgent.didManagerCreate({ provider: "did:key" });
    expect(identifier.did.startsWith("did:key:")).toBe(true);
    expect(identifier.keys.length).toBeGreaterThan(0);

    const resolution = await veramoAgent.resolveDid({ didUrl: identifier.did });
    expect(resolution.didResolutionMetadata.error).toBeUndefined();
    expect(resolution.didDocument?.id).toBe(identifier.did);
  });

  it("deletes an identifier and its keys", async () => {
    const identifier = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const deleted = await veramoAgent.didManagerDelete({ did: identifier.did });
    expect(deleted).toBe(true);
  });
});

// A raw Ed25519 signer for exercising didwebvh-ts's own createDID/
// resolveDIDFromLog directly, independent of the Veramo bridge -- proves
// the underlying did:webvh mechanics (hash-chained log, DataIntegrityProof)
// work without needing a live HTTPS endpoint for full network resolution,
// which is a Phase 1 open item (see docs/ARCHITECTURE.md), not testable
// from this local suite yet.
class TestEd25519Signer extends AbstractCrypto {
  constructor(
    private readonly privateKey: Uint8Array,
    verificationMethod: { id?: string; type: string; publicKeyMultibase?: string },
  ) {
    super({ verificationMethod: verificationMethod as never });
  }
  async sign(input: { document: unknown; proof: never }) {
    const dataToSign = await prepareDataForSigning(input.document, input.proof);
    const signature = ed25519.sign(dataToSign, this.privateKey);
    return { proofValue: multibaseEncode(signature, MultibaseEncoding.BASE58_BTC) };
  }
  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    return ed25519.verify(signature, message, publicKey);
  }
}

describe("did:webvh mechanics (direct, no Veramo, no network)", () => {
  it("creates a DID log and resolves it from the in-memory log", async () => {
    const privateKey = ed25519.utils.randomSecretKey();
    const publicKey = ed25519.getPublicKey(privateKey);
    // Multikey requires the 0xed01 Ed25519 multicodec prefix before the raw
    // key bytes -- see the matching fix/comment in src/identity/webvhDidProvider.ts.
    const prefixedPublicKey = new Uint8Array([0xed, 0x01, ...publicKey]);
    const publicKeyMultibase = multibaseEncode(prefixedPublicKey, MultibaseEncoding.BASE58_BTC);
    const signer = new TestEd25519Signer(privateKey, { type: "Multikey", publicKeyMultibase });

    const result = await createDID({
      domain: "id.dcentral-fieldops.test",
      signer,
      verifier: signer,
      updateKeys: [publicKeyMultibase],
      verificationMethods: [{ type: "Multikey", publicKeyMultibase }],
    });

    expect(result.did.startsWith("did:webvh:")).toBe(true);
    expect(result.log.length).toBeGreaterThan(0);

    const resolved = await resolveDIDFromLog(result.log, { verifier: ed25519Verifier });
    expect(resolved.did).toBe(result.did);
    expect(resolved.meta.versionId).toBeDefined();
  });
});
