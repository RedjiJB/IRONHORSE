// Wraps a tool callback so it never runs unless the caller's presented
// CapabilityGrant VC actually clears the tier this tool declares. See
// src/identity/capabilities.ts for why this is argument-based
// (`credentialJwt`) rather than HTTP-bearer-only -- it has to work
// identically over stdio, which has no HTTP layer.
import type { CapabilityTier } from "../identity/capabilities.js";
import { verifyPresentedCapability } from "../identity/capabilities.js";
import { getHeaderCredentialJwt } from "./requestContext.js";

export class CapabilityDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`Capability check failed: ${reason}`);
  }
}

// credentialJwt is normally supplied as a tool-call argument (required for
// stdio, which has no header concept). When a caller omits it, this falls
// back to a credential attached to the current HTTP request via
// requestContext.ts -- the path a static per-server header (e.g. OpenClaw's
// `mcp add --header`) takes. Either way the same verifyPresentedCapability
// check runs -- the fallback source is not a weaker trust path, just a
// different way of attaching the same kind of credential.
export async function requireCapability(
  credentialJwt: string | undefined,
  capability: string,
  minimumTier: CapabilityTier,
): Promise<{ subjectDid: string; tier: CapabilityTier }> {
  const jwt = credentialJwt ?? getHeaderCredentialJwt();
  if (!jwt) throw new CapabilityDeniedError("missing_credential");
  const result = await verifyPresentedCapability(jwt, capability, minimumTier);
  if (!result.allowed) {
    throw new CapabilityDeniedError(result.reason);
  }
  return { subjectDid: result.subjectDid, tier: result.tier };
}
