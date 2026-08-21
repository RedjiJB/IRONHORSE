// Wraps didwebvh-ts's own resolveDID (which independently re-derives and
// verifies the DID's hash-chained history log) into the did-resolver
// interface Veramo's DIDResolverPlugin expects.
import type { DIDResolutionResult, DIDResolver } from "did-resolver";
import { resolveDID } from "didwebvh-ts";
import { ed25519Verifier } from "./ed25519Verifier.js";

export function getDidWebvhResolver(): { webvh: DIDResolver } {
  return {
    webvh: async (did: string): Promise<DIDResolutionResult> => {
      // Confirmed live during Phase 1 testing (see webvhDidProvider.ts's
      // matching fix): resolution independently re-verifies every log
      // entry's proof, and silently omitting a verifier here was a real
      // bug -- every did:webvh resolution before this fix would have
      // thrown "Verifier implementation is required" the moment it was
      // ever actually exercised.
      const result = await resolveDID(did, { verifier: ed25519Verifier });
      if ("error" in result.meta) {
        return {
          didResolutionMetadata: { error: result.meta.error === "notFound" ? "notFound" : "invalidDid" },
          didDocument: null,
          didDocumentMetadata: {},
        };
      }
      return {
        didResolutionMetadata: {},
        // didwebvh-ts's DIDDoc shape is a superset of the standard
        // DIDDocument -- cast is safe, not a lie: every field the standard
        // requires is present, extras are ignored by callers that don't
        // know about them.
        didDocument: result.doc as unknown as DIDResolutionResult["didDocument"],
        didDocumentMetadata: { ...(result as { meta?: object }).meta },
      };
    },
  };
}
