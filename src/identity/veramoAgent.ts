// The Veramo agent: DID management (did:key, did:webvh), a KMS-backed
// signing key store, a DID resolver covering both methods, and W3C
// credential issue/verify.
//
// KNOWN PHASE-1 GAP, flagged not hidden: key/DID material is held in
// Veramo's in-memory stores (MemoryKeyStore/MemoryPrivateKeyStore/
// MemoryDIDStore) -- real, working, but NOT durable across a process
// restart. This is acceptable for the Phase 1 skeleton (proving the
// DID/VC/capability flow works end to end) but is a hard blocker before
// this agent identity is used for anything beyond local dev/testing --
// see docs/ARCHITECTURE.md's open items. The domain data this system
// actually cares about long-term (capability_grants, nodes,
// agent_identities) already lives in real Postgres, per src/db/migrations/
// -- only the raw private key material itself is affected by this gap.
import "dotenv/config";
import { createAgent } from "@veramo/core";
import { CredentialProviderJWT } from "@veramo/credential-jwt";
import { CredentialPlugin } from "@veramo/credential-w3c";
import { DIDManager, MemoryDIDStore } from "@veramo/did-manager";
import { getDidKeyResolver, KeyDIDProvider } from "@veramo/did-provider-key";
import { DIDResolverPlugin } from "@veramo/did-resolver";
import { KeyManager, MemoryKeyStore, MemoryPrivateKeyStore } from "@veramo/key-manager";
import { KeyManagementSystem } from "@veramo/kms-local";
import { Resolver } from "did-resolver";
import { getDidWebvhResolver } from "./webvhResolver.js";
import { WebvhDIDProvider } from "./webvhDidProvider.js";

const DEFAULT_KMS = "local";

export const veramoAgent = createAgent({
  plugins: [
    new KeyManager({
      store: new MemoryKeyStore(),
      kms: { [DEFAULT_KMS]: new KeyManagementSystem(new MemoryPrivateKeyStore()) },
    }),
    new DIDManager({
      store: new MemoryDIDStore(),
      defaultProvider: "did:key",
      providers: {
        "did:key": new KeyDIDProvider({ defaultKms: DEFAULT_KMS }),
        "did:webvh": new WebvhDIDProvider(DEFAULT_KMS),
      },
    }),
    new DIDResolverPlugin({
      resolver: new Resolver({
        ...getDidKeyResolver(),
        ...getDidWebvhResolver(),
      }),
    }),
    new CredentialPlugin([new CredentialProviderJWT()]),
  ],
});

export type VeramoAgent = typeof veramoAgent;
