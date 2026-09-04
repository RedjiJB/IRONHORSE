// Short-lived bearer access tokens for the REST façade (src/facade/) --
// deliberately NOT a VerifiableCredential (vc.ts's shape exists for
// genuine third-party-verifiable holder credentials; this is an internal
// bearer artifact for this same backend, a different concern). Signed
// with the node's own existing Ed25519 key -- zero new secrets, reuses
// the same key infrastructure every DID in this system already relies
// on. The role claim is carried for the frontend's own immediate-paint
// UX only; the façade never trusts it for an authorization decision (see
// src/facade/auth.ts) -- same "DB is authoritative, not the token" stance
// the frontend's own useAuthStore already takes.
import { jwtVerify, SignJWT, importJWK } from "jose";
import { errors as joseErrors } from "jose";
import { loadPrivateKey } from "./keys.js";
import { resolveDid } from "./did.js";
import { getOrCreateSelfNode } from "./node.js";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export type AccessTokenClaims = { userId: string; userDid: string; role: string };

export async function issueAccessTokenJwt(claims: AccessTokenClaims): Promise<string> {
  const selfNode = await getOrCreateSelfNode();
  const privateKey = await loadPrivateKey(selfNode.did);
  return new SignJWT({ uid: claims.userId, role: claims.role })
    .setProtectedHeader({ alg: "EdDSA" })
    .setIssuer(selfNode.did)
    .setSubject(claims.userDid)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS)
    .sign(privateKey);
}

export type VerifyAccessTokenResult =
  | { ok: true; userId: string; userDid: string; role: string }
  | { ok: false; reason: "malformed" | "signature_invalid" | "expired" };

export async function verifyAccessTokenJwt(jwt: string): Promise<VerifyAccessTokenResult> {
  const selfNode = await getOrCreateSelfNode();
  const publicJwk = await resolveDid(selfNode.did);
  if (!publicJwk) return { ok: false, reason: "malformed" };

  try {
    const publicKey = await importJWK(publicJwk, "EdDSA");
    const { payload } = await jwtVerify(jwt, publicKey, { issuer: selfNode.did });
    const userId = payload.uid as string | undefined;
    const role = payload.role as string | undefined;
    const userDid = payload.sub;
    if (!userId || !role || !userDid) return { ok: false, reason: "malformed" };
    return { ok: true, userId, userDid, role };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) return { ok: false, reason: "expired" };
    return { ok: false, reason: "signature_invalid" };
  }
}
