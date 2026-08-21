// Issuing and verifying credentials as plain signed JWTs -- no Veramo, no
// W3C VC-JWT framework dependency. A deliberately minimal, self-contained
// format: an EdDSA-signed JWT with a `vc` claim carrying the credential
// type and subject, verified against the issuer DID's key resolved via
// did.ts. jose supplies JWS/JWT mechanics only (RFC 7515/7519); the
// credential shape and every verification decision here is this
// project's own.
//
// Two credential types share the signing/verification plumbing below:
// CapabilityGrant (what an agent or crew DID is authorized to do, and at
// what tier) and PhoneBinding (which real phone number a crew DID's
// WhatsApp identity resolves to -- see src/domain/crewMembers.ts). Both
// are genuine VerifiableCredentials, not a capability-shaped hack reused
// for an unrelated claim.
import { decodeJwt, jwtVerify, SignJWT, importJWK } from "jose";
import { errors as joseErrors } from "jose";
import { loadPrivateKey } from "./keys.js";
import { resolveDid } from "./did.js";

type SignCredentialArgs = {
  issuerDid: string;
  subjectDid: string;
  credentialType: string;
  claims: Record<string, unknown>;
  expiresAt?: Date;
};

async function signCredentialJwt(args: SignCredentialArgs): Promise<string> {
  const privateKey = await loadPrivateKey(args.issuerDid);
  let jwt = new SignJWT({
    vc: {
      type: ["VerifiableCredential", args.credentialType],
      credentialSubject: { id: args.subjectDid, ...args.claims },
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

type VerifyCredentialResult =
  | {
      ok: true;
      issuerDid: string;
      subjectDid: string;
      credentialType: string[];
      claims: Record<string, unknown>;
    }
  | { ok: false; reason: "malformed" | "unknown_issuer" | "signature_invalid" | "expired" };

async function verifyCredentialJwt(jwt: string): Promise<VerifyCredentialResult> {
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

    const vc = payload.vc as { type?: string[]; credentialSubject?: { id?: string; [key: string]: unknown } } | undefined;
    const subjectDid = vc?.credentialSubject?.id;
    if (!vc?.type || !subjectDid) return { ok: false, reason: "malformed" };

    const { id: _id, ...claims } = vc.credentialSubject!;
    return { ok: true, issuerDid, subjectDid, credentialType: vc.type, claims };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    // Signature failure, malformed compact serialization, claim mismatch
    // (e.g. iss no longer matches after tampering) -- all genuinely mean
    // "don't trust this token", collapsed to one reason rather than
    // distinguishing further.
    return { ok: false, reason: "signature_invalid" };
  }
}

// ---- CapabilityGrant ----

export type CapabilityGrantJwtArgs = {
  issuerDid: string;
  subjectDid: string;
  capability: string;
  tier: number;
  expiresAt?: Date;
};

export async function issueCapabilityGrantJwt(args: CapabilityGrantJwtArgs): Promise<string> {
  return signCredentialJwt({
    issuerDid: args.issuerDid,
    subjectDid: args.subjectDid,
    credentialType: "CapabilityGrant",
    claims: { capability: args.capability, tier: args.tier },
    expiresAt: args.expiresAt,
  });
}

export type VerifyCapabilityGrantResult =
  | { ok: true; issuerDid: string; subjectDid: string; capability: string; tier: number }
  | { ok: false; reason: "malformed" | "unknown_issuer" | "signature_invalid" | "expired" | "wrong_credential_type" };

export async function verifyCapabilityGrantJwt(jwt: string): Promise<VerifyCapabilityGrantResult> {
  const result = await verifyCredentialJwt(jwt);
  if (!result.ok) return result;
  if (!result.credentialType.includes("CapabilityGrant")) return { ok: false, reason: "wrong_credential_type" };

  const capability = result.claims.capability as string | undefined;
  const tier = result.claims.tier as number | undefined;
  if (!capability || tier === undefined) return { ok: false, reason: "malformed" };

  return { ok: true, issuerDid: result.issuerDid, subjectDid: result.subjectDid, capability, tier };
}

// ---- PhoneBinding ----
// Binds a crew DID to the real phone number its WhatsApp identity resolves
// to. Deliberately a separate credential from CapabilityGrant -- a phone
// number is an attribute claim, not an authorization claim, and conflating
// the two would mean revoking someone's phone binding also revokes
// whatever they're allowed to do, or vice versa, which are genuinely
// independent concerns.

export type PhoneBindingJwtArgs = {
  issuerDid: string;
  subjectDid: string;
  phone: string;
  expiresAt?: Date;
};

export async function issuePhoneBindingJwt(args: PhoneBindingJwtArgs): Promise<string> {
  return signCredentialJwt({
    issuerDid: args.issuerDid,
    subjectDid: args.subjectDid,
    credentialType: "PhoneBinding",
    claims: { phone: args.phone },
    expiresAt: args.expiresAt,
  });
}

export type VerifyPhoneBindingResult =
  | { ok: true; issuerDid: string; subjectDid: string; phone: string }
  | { ok: false; reason: "malformed" | "unknown_issuer" | "signature_invalid" | "expired" | "wrong_credential_type" };

export async function verifyPhoneBindingJwt(jwt: string): Promise<VerifyPhoneBindingResult> {
  const result = await verifyCredentialJwt(jwt);
  if (!result.ok) return result;
  if (!result.credentialType.includes("PhoneBinding")) return { ok: false, reason: "wrong_credential_type" };

  const phone = result.claims.phone as string | undefined;
  if (!phone) return { ok: false, reason: "malformed" };

  return { ok: true, issuerDid: result.issuerDid, subjectDid: result.subjectDid, phone };
}
