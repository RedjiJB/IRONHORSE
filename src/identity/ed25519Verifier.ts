// A stateless Ed25519 Verifier for didwebvh-ts's resolution path (distinct
// from VeramoWebvhSigner's Signer role in webvhDidProvider.ts -- resolving
// a DID's log needs to check signatures against whatever public key each
// log entry names, not one tied to a caller's own key/context).
import type { Verifier } from "./webvhTypes.js";
import { ed25519 } from "@noble/curves/ed25519.js";

export const ed25519Verifier: Verifier = {
  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    return ed25519.verify(signature, message, publicKey);
  },
};
