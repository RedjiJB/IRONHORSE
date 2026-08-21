// Issuing and verifying "CapabilityGrant" credentials as plain signed
// JWTs -- no Veramo, no W3C VC-JWT framework dependency. This is a
// deliberately minimal, self-contained format: an EdDSA-signed JWT with a
// `vc` claim carrying the credential type and subject, verified against
// the issuer DID's key resolved via did.ts. jose supplies JWS/JWT
// mechanics only (RFC 7515/7519); the credential shape and every
// verification decision here is this project's own.
import { decodeJwt, jwtVerify, SignJWT, importJWK } from "jose";
import { errors as joseErrors } from "jose";
import { loadPrivateKey } from "./keys.js";
import { resolveDid } from "./did.js";

export type CapabilityGrantJwtArgs = {
  issuerDid: string;
  subjectDid: string;
  capability: string;
  tier: number;
  expiresAt?: Date;
};

export async function issueCapabilityGrantJwt(args: CapabilityGrantJwtArgs): Promise<string> {
  const privateKey = await loadPrivateKey(args.issuerDid);
  let jwt = new SignJWT({
    vc: {
      type: ["VerifiableCredential", "CapabilityGrant"],
      credentialSubject: { id: args.subjectDid, capability: args.capability, tier: args.tier },
    },
  })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(args.issuerDid)
    .setSubject(args.subjectDid)
    .setIssuedAt();
  if (args.expiresAt) {
    jwt = jwt.setExpirationTime(Math.floor(args.expiresAt.getTime() / 1000));
  }
  return jwt.sign(privateKey);
}

export type VerifyCapabilityGrantResult =
  | {
      ok: true;
      issuerDid: string;
      subjectDid: string;
      capability: string;
      tier: number;
    }
  | { ok: false; reason: "malformed" | "unknown_issuer" | "signature_invalid" | "expired" | "wrong_credential_type" };

export async function verifyCapabilityGrantJwt(jwt: string): Promise<VerifyCapabilityGrantResult> {
  let issuerDid: string | undefined;
  try {
    issuerDid = decodeJwt(jwt).iss;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!issuerDid) return { ok: false, reason: "malformed" };

  const publicJwk = await resolveDid(issuerDid);
  if (!publicJwk) return { ok: false, reason: "unknown_issuer" };

  try {
    const publicKey = await importJWK(publicJwk, "EdDSA");
    const { payload } = await jwtVerify(jwt, publicKey, { issuer: issuerDid });

    const vc = payload.vc as
      | { type?: string[]; credentialSubject?: { id?: string; capability?: string; tier?: number } }
      | undefined;
    if (!vc?.type?.includes("CapabilityGrant")) {
      return { ok: false, reason: "wrong_credential_type" };
    }
    const subjectDid = vc.credentialSubject?.id;
    const capability = vc.credentialSubject?.capability;
    const tier = vc.credentialSubject?.tier;
    if (!subjectDid || !capability || tier === undefined) {
      return { ok: false, reason: "malformed" };
    }
    return { ok: true, issuerDid, subjectDid, capability, tier };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    // Signature failure, malformed compact serialization, claim mismatch
    // (e.g. iss no longer matches after tampering) -- all genuinely mean
    // "don't trust this token", collapsed to one reason rather than
    // distinguishing further.
    return { ok: false, reason: "signature_invalid" };
  }
}
