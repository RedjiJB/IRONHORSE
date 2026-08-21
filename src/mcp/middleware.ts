// Wraps a tool callback so it never runs unless the caller's presented
// CapabilityGrant VC actually clears the tier this tool declares. See
// src/identity/capabilities.ts for why this is argument-based
// (`credentialJwt`) rather than HTTP-bearer-only -- it has to work
// identically over stdio, which has no HTTP layer.
import type { CapabilityTier } from "../identity/capabilities.js";
import { verifyPresentedCapability } from "../identity/capabilities.js";

export class CapabilityDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`Capability check failed: ${reason}`);
  }
}

export async function requireCapability(
  credentialJwt: string,
  capability: string,
  minimumTier: CapabilityTier,
): Promise<{ subjectDid: string; tier: CapabilityTier }> {
  const result = await verifyPresentedCapability(credentialJwt, capability, minimumTier);
  if (!result.allowed) {
    throw new CapabilityDeniedError(result.reason);
  }
  return { subjectDid: result.subjectDid, tier: result.tier };
}
