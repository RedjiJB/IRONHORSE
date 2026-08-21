// Local aliases for didwebvh-ts's own interfaces.ts types (confirmed by
// reading the package's .d.ts directly), kept here because re-importing
// them through the package's top-level barrel doesn't resolve cleanly
// under this project's NodeNext module resolution. Shared by
// webvhDidProvider.ts and ed25519Verifier.ts -- kept minimal to what this
// project actually uses, not a full mirror of the upstream package.
export type VerificationMethod = {
  id?: string;
  type: string;
  controller?: string;
  publicKeyMultibase?: string;
  secretKeyMultibase?: string;
  publicKeyJwk?: Record<string, unknown>;
  use?: string;
};

export type SigningInput = {
  document: unknown;
  proof: { verificationMethod: string; [key: string]: unknown };
};

export type SigningOutput = { proofValue: string };

export type Verifier = {
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean>;
};
