// Real interface, real (if trivial) implementation -- not a placeholder.
// A second D-Central node later means a new FederationTransport
// implementation (e.g. one that actually posts to a peer's MCP endpoint),
// not a redesign of anything that calls this interface. See
// docs/ARCHITECTURE.md "Federation-ready, genuinely single-node".
export type FederationEnvelope = {
  actorDid: string; // the sending node/agent's DID
  capability: string; // what this message concerns, mirrors capability_grants.capability
  payload: unknown;
};

export interface FederationTransport {
  send(peerId: string, envelope: FederationEnvelope): Promise<void>;
  receive(): AsyncIterable<{ fromPeerId: string; envelope: FederationEnvelope }>;
  listKnownPeers(): Promise<{ id: string; nodeId: string; transport: string }[]>;
}

// The only implementation that exists today: there is no second node, so
// "send" delivers nowhere and logs what it would have done; "receive"
// yields nothing. This is deliberately a real, working no-op -- not a
// throw-not-implemented stub -- so code that depends on FederationTransport
// can be written and tested against it now, before a second node exists.
export class LoopbackFederationTransport implements FederationTransport {
  async send(peerId: string, envelope: FederationEnvelope): Promise<void> {
    console.log(`[federation:loopback] would send to peer ${peerId}:`, envelope);
  }

  // eslint-disable-next-line require-yield -- intentionally empty: no
  // peers exist yet to receive from.
  async *receive(): AsyncIterable<{ fromPeerId: string; envelope: FederationEnvelope }> {
    return;
  }

  async listKnownPeers(): Promise<{ id: string; nodeId: string; transport: string }[]> {
    return [];
  }
}
