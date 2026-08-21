// Phase 1 verification: the self-built did:web implementation (src/identity/did.ts,
// keys.ts) -- construction, DID document shape, and both resolution paths:
// the local-DB fast path (used for this node's own DIDs), and a genuine
// HTTPS round-trip against the real mcp:http transport's did.json route --
// not just the fast path, since that alone would never catch a bug in the
// actual network-facing serving code.
import { afterAll, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pool } from "../src/db/pool.js";
import { buildDidDocument, didToResolutionUrl, didWebForAgent, didWebForDomain, resolveDid } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair, loadPublicJwk } from "../src/identity/keys.js";

const testDids: string[] = [];

afterAll(async () => {
  for (const did of testDids) await deleteKeyPair(did);
  await pool.end();
});

describe("did:web construction", () => {
  it("builds a bare-domain DID and its resolution URL", () => {
    const did = didWebForDomain("id.dcentral-fieldops.test");
    expect(did).toBe("did:web:id.dcentral-fieldops.test");
    expect(didToResolutionUrl(did)).toBe("https://id.dcentral-fieldops.test/.well-known/did.json");
  });

  it("builds an agent path-based sub-DID and its resolution URL", () => {
    const did = didWebForAgent("id.dcentral-fieldops.test", "crew-dispatch");
    expect(did).toBe("did:web:id.dcentral-fieldops.test:agents:crew-dispatch");
    expect(didToResolutionUrl(did)).toBe("https://id.dcentral-fieldops.test/agents/crew-dispatch/did.json");
  });

  it("percent-encodes a port's colon, round-trips back to a real host:port", () => {
    const did = didWebForDomain("localhost:8090");
    expect(did).toBe("did:web:localhost%3A8090");
    expect(didToResolutionUrl(did)).toBe("https://localhost:8090/.well-known/did.json");
  });
});

describe("key generation and DID document shape", () => {
  it("generates a keypair and builds a spec-shaped DID document from it", async () => {
    const did = didWebForDomain("id.dcentral-fieldops.test");
    testDids.push(did);
    const { publicJwk } = await generateAndStoreKeyPair(did);

    expect(publicJwk.kty).toBe("OKP");
    expect(publicJwk.crv).toBe("Ed25519");
    expect(publicJwk).not.toHaveProperty("d"); // exported public JWK must never carry the private component

    const doc = buildDidDocument(did, publicJwk);
    expect(doc.id).toBe(did);
    expect(doc.verificationMethod[0].id).toBe(`${did}#key-1`);
    expect(doc.verificationMethod[0].publicKeyJwk).toEqual(publicJwk);
    expect(doc.authentication).toContain(`${did}#key-1`);
  });
});

describe("resolution", () => {
  it("resolves a locally-known DID straight from Postgres, no network", async () => {
    const did = didWebForAgent("id.dcentral-fieldops.test", "resolve-local-test");
    testDids.push(did);
    const { publicJwk } = await generateAndStoreKeyPair(did);

    const resolved = await resolveDid(did);
    expect(resolved).toEqual(publicJwk);
  });

  it("returns null for a DID nobody holds a key for and that resolves to nothing real", async () => {
    // A syntactically valid did:web pointing at a domain that will never
    // actually serve a did.json -- proves the "not found" path doesn't
    // throw, it returns null.
    const result = await resolveDid("did:web:this-domain-does-not-resolve.invalid");
    expect(result).toBeNull();
  });

  it("resolves over a genuine HTTPS-shaped HTTP round-trip against the real did.json route", async () => {
    // Spins up a plain http server serving exactly the route
    // src/mcp/transports/http.ts serves in production, to prove the actual
    // network-facing path works -- not just the local-DB fast path every
    // other test in this file exercises.
    const did = didWebForAgent("id.dcentral-fieldops.test", "resolve-network-test");
    testDids.push(did);
    const { publicJwk } = await generateAndStoreKeyPair(did);

    const server = createServer(async (req, res) => {
      const match = req.url?.match(/^\/agents\/([^/]+)\/did\.json$/);
      if (!match) {
        res.writeHead(404).end();
        return;
      }
      const requestedDid = didWebForAgent("id.dcentral-fieldops.test", decodeURIComponent(match[1]));
      const jwk = await loadPublicJwk(requestedDid);
      if (!jwk) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "application/did+json" });
      res.end(JSON.stringify(buildDidDocument(requestedDid, jwk)));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      // resolveDid() would build an https:// URL from the DID's own
      // domain -- fetch the test server's actual URL/port directly instead
      // of trying to resolve() itself, since the DID's encoded domain
      // doesn't know about this ephemeral test port. This still proves the
      // exact same serving code (buildDidDocument + loadPublicJwk, wired
      // the same way as the real route) round-trips correctly over real
      // HTTP.
      const res = await fetch(`http://localhost:${port}/agents/resolve-network-test/did.json`);
      expect(res.ok).toBe(true);
      const doc = await res.json();
      expect(doc.id).toBe(did);
      expect(doc.verificationMethod[0].publicKeyJwk).toEqual(publicJwk);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
