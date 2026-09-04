// A from-scratch did:web implementation -- no Veramo, no didwebvh-ts.
// did:web (not did:webvh) by explicit choice: simpler, no hash-chained
// key-rotation history to implement or maintain, resolves over plain
// HTTPS the same way this project already serves everything else.
//
// Both the node's own long-lived identity and every agent identity are
// did:web under the same domain now -- a bare-domain DID for the node
// (did:web:<domain>) and a path-based sub-DID per agent
// (did:web:<domain>:agents:<role>), all resolvable through one mechanism
// instead of mixing did:web (node) with did:key (agents) as the earlier
// Veramo-based design did.
import type { JWK } from "jose";
import { loadPublicJwk } from "./keys.js";

export type DidDocument = {
  "@context": string[];
  id: string;
  verificationMethod: {
    id: string;
    type: "JsonWebKey2020";
    controller: string;
    publicKeyJwk: JWK;
  }[];
  authentication: string[];
  assertionMethod: string[];
};

// did:web domain encoding per the spec: a port's colon is percent-encoded
// as %3A (e.g. did:web:localhost%3A8090); path segments after the domain
// are colon-separated in the DID, slash-separated in the URL they resolve
// to.
export function didWebForDomain(domain: string): string {
  return `did:web:${domain.replace(":", "%3A")}`;
}

export function didWebForAgent(domain: string, role: string): string {
  return `did:web:${domain.replace(":", "%3A")}:agents:${encodeURIComponent(role)}`;
}

export function didToResolutionUrl(did: string): string {
  const parts = did.split(":");
  if (parts[0] !== "did" || parts[1] !== "web") {
    throw new Error(`Not a did:web identifier: ${did}`);
  }
  const domain = decodeURIComponent(parts[2] ?? "").replace("%3A", ":");
  if (!domain) throw new Error(`Malformed did:web identifier: ${did}`);
  const pathSegments = parts.slice(3).map(decodeURIComponent);

  return pathSegments.length === 0
    ? `https://${domain}/.well-known/did.json`
    : `https://${domain}/${pathSegments.join("/")}/did.json`;
}

export function buildDidDocument(did: string, publicJwk: JWK): DidDocument {
  const verificationMethodId = `${did}#key-1`;
  return {
    "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/jws-2020/v1"],
    id: did,
    verificationMethod: [
      { id: verificationMethodId, type: "JsonWebKey2020", controller: did, publicKeyJwk: publicJwk },
    ],
    authentication: [verificationMethodId],
    assertionMethod: [verificationMethodId],
  };
}

// Resolves a did:web to its public JWK. Local DIDs (anything this node has
// a stored keypair for -- itself, or any of its own agents) resolve
// straight from Postgres, no network round-trip -- this is both an
// optimization and what makes tests possible without a real HTTPS server
// actually serving did.json documents. A DID this node doesn't hold a key
// for falls through to a real HTTPS fetch of the document, per spec --
// this is the path a genuinely remote (future federated peer's) DID would
// take.
export async function resolveDid(did: string): Promise<JWK | null> {
  const localJwk = await loadPublicJwk(did);
  if (localJwk) return localJwk;

  const url = didToResolutionUrl(did);
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const doc = (await res.json()) as DidDocument;
    return doc.verificationMethod?.[0]?.publicKeyJwk ?? null;
  } catch {
    // DNS failure, connection refused, malformed JSON, or anything else
    // that means "this DID does not actually resolve to anything real" --
    // all collapse to the same "unknown issuer" result a caller sees from
    // a 404, not a thrown exception. A resolution failure is exactly as
    // legitimate an outcome as "not found" for a DID this node has no
    // relationship with.
    return null;
  }
}
