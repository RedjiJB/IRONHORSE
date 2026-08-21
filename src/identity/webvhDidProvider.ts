// A Veramo AbstractIdentifierProvider for did:webvh -- no ready-made
// Veramo<->didwebvh-ts bridge exists on npm (checked directly, not
// assumed), so this is genuinely new integration code, not glue between
// two libraries that already talk to each other.
//
// Key material never leaves Veramo's KeyManager/KMS: didwebvh-ts's
// AbstractCrypto handles JCS canonicalization + hashing internally
// (prepareDataForSigning) and this class only turns the resulting bytes
// into a signature via context.agent.keyManagerSign, then multibase
// base58btc-encodes it into the DataIntegrityProof shape didwebvh-ts
// expects.
import type {
  IAgentContext,
  IIdentifier,
  IKey,
  IKeyManager,
  IService,
} from "@veramo/core-types";
import { AbstractIdentifierProvider } from "@veramo/did-manager";
import {
  AbstractCrypto,
  createDID,
  multibaseEncode,
  MultibaseEncoding,
  prepareDataForSigning,
} from "didwebvh-ts";
import type { SigningInput, SigningOutput, VerificationMethod } from "./webvhTypes.js";
import { ed25519Verifier } from "./ed25519Verifier.js";

type IContext = IAgentContext<IKeyManager>;

class VeramoWebvhSigner extends AbstractCrypto {
  constructor(
    private readonly context: IContext,
    private readonly kid: string,
    verificationMethod: VerificationMethod,
  ) {
    super({ verificationMethod });
  }

  async sign(input: SigningInput): Promise<SigningOutput> {
    const dataToSign = await prepareDataForSigning(input.document, input.proof);
    const signatureBase64Url = await this.context.agent.keyManagerSign({
      keyRef: this.kid,
      algorithm: "EdDSA",
      data: Buffer.from(dataToSign).toString("base64"),
      encoding: "base64",
    });
    const signatureBytes = Buffer.from(signatureBase64Url, "base64url");
    return { proofValue: multibaseEncode(signatureBytes, MultibaseEncoding.BASE58_BTC) };
  }

  // Confirmed live (not assumed) during Phase 1 testing: didwebvh-ts's
  // createDID actually requires a working verifier at DID-creation time
  // (it self-checks the log entry it just produced before returning) --
  // "verification happens later in resolveDID" was wrong.
  async verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
    return ed25519Verifier.verify(signature, message, publicKey);
  }
}

export type CreateWebvhDidOptions = {
  /** Domain this DID resolves under, e.g. "id.dcentral-fieldops.local" */
  domain: string;
  /** URL path segments after the domain, if any -- omit for a bare domain-root DID */
  paths?: string[];
};

export class WebvhDIDProvider extends AbstractIdentifierProvider {
  constructor(private readonly defaultKms: string) {
    super();
  }

  matchPrefix(prefix: string): boolean {
    return prefix.startsWith("did:webvh:");
  }

  async createIdentifier(
    args: { kms?: string; alias?: string; options?: CreateWebvhDidOptions },
    context: IContext,
  ): Promise<Omit<IIdentifier, "provider">> {
    if (!args.options?.domain) {
      throw new Error("WebvhDIDProvider.createIdentifier requires options.domain");
    }
    const kms = args.kms ?? this.defaultKms;

    const key = await context.agent.keyManagerCreate({ kms, type: "Ed25519" });

    // did:webvh's own key-thumbprint-derived did:key form (used as the
    // update key / verification-method reference) is computed by
    // createDID itself from the signer's verification method -- we only
    // need to hand it a Veramo-backed signer and the raw public key.
    //
    // Confirmed live during Phase 1 testing: a "Multikey" publicKeyMultibase
    // is NOT just the raw public key bytes multibase-encoded -- the W3C
    // Multikey spec requires a 2-byte multicodec prefix (0xed01 for
    // Ed25519) before multibase-encoding, or didwebvh-ts's own log
    // validation rejects it with "multiKey doesn't include ed25519 header".
    const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
    const rawPublicKey = Buffer.from(key.publicKeyHex, "hex");
    const prefixedPublicKey = Buffer.concat([ED25519_MULTICODEC_PREFIX, rawPublicKey]);
    const verificationMethod: VerificationMethod = {
      type: "Multikey",
      publicKeyMultibase: multibaseEncode(prefixedPublicKey, MultibaseEncoding.BASE58_BTC),
    } as VerificationMethod;

    const signer = new VeramoWebvhSigner(context, key.kid, verificationMethod);

    const result = await createDID({
      domain: args.options.domain,
      paths: args.options.paths,
      signer,
      verifier: ed25519Verifier,
      updateKeys: [verificationMethod.publicKeyMultibase as string],
      verificationMethods: [verificationMethod],
    });

    return {
      did: result.did,
      controllerKeyId: key.kid,
      keys: [key],
      services: [],
    };
  }

  async updateIdentifier(): Promise<IIdentifier> {
    throw new Error(
      "WebvhDIDProvider.updateIdentifier is not yet implemented -- key rotation via " +
        "didwebvh-ts's updateDID is real future work, not built in Phase 1.",
    );
  }

  async deleteIdentifier(identifier: IIdentifier, context: IContext): Promise<boolean> {
    for (const key of identifier.keys) {
      await context.agent.keyManagerDelete({ kid: key.kid });
    }
    return true;
  }

  async addKey(): Promise<never> {
    throw new Error("WebvhDIDProvider.addKey is not yet implemented.");
  }

  async removeKey(): Promise<never> {
    throw new Error("WebvhDIDProvider.removeKey is not yet implemented.");
  }

  async addService(): Promise<never> {
    throw new Error("WebvhDIDProvider.addService is not yet implemented.");
  }

  async removeService(): Promise<never> {
    throw new Error("WebvhDIDProvider.removeService is not yet implemented.");
  }
}
