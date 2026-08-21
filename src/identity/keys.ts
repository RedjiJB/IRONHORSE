// Ed25519 keypair generation and storage -- replaces Veramo's KMS/key
// stores entirely. jose is used purely for JWK export/import mechanics
// (RFC 7517) and JWT signing (RFC 7515/7519) -- it is not a DID/VC
// framework; the DID method (did.ts), document shape, and credential shape
// (vc.ts) are all this project's own code, not jose's or any other
// library's opinion of what those should look like.
import { exportJWK, generateKeyPair, importJWK } from "jose";
import type { CryptoKey, JWK, KeyObject } from "jose";
import { pool } from "../db/pool.js";

export async function generateAndStoreKeyPair(did: string): Promise<{ publicJwk: JWK }> {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  // JSONB columns need an explicit JSON.stringify -- node-postgres does not
  // serialize plain objects for jsonb parameters on its own (it would
  // otherwise send "[object Object]").
  await pool.query(
    `INSERT INTO keys (did, public_jwk, private_jwk, algorithm) VALUES ($1, $2, $3, 'EdDSA')`,
    [did, JSON.stringify(publicJwk), JSON.stringify(privateJwk)],
  );

  return { publicJwk };
}

export async function loadPrivateKey(did: string): Promise<CryptoKey | KeyObject | Uint8Array> {
  const result = await pool.query("SELECT private_jwk FROM keys WHERE did = $1", [did]);
  const row = result.rows[0];
  if (!row) throw new Error(`No private key stored for ${did}`);
  return importJWK(row.private_jwk as JWK, "EdDSA");
}

export async function loadPublicJwk(did: string): Promise<JWK | null> {
  const result = await pool.query("SELECT public_jwk FROM keys WHERE did = $1", [did]);
  return (result.rows[0]?.public_jwk as JWK) ?? null;
}

export async function deleteKeyPair(did: string): Promise<void> {
  await pool.query("DELETE FROM keys WHERE did = $1", [did]);
}
