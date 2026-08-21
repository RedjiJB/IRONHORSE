// Phase 1 verification item: "MCP server boots, exposes whoami/
// list_capabilities... capability-tier middleware denies/allows
// correctly." Uses InMemoryTransport to exercise the real McpServer
// instance and real tool-calling/capability-gating logic without spawning
// a process -- the stdio and Streamable HTTP transports themselves (thin
// wrappers around the same mcpServer/createMcpHandler) are smoke-tested
// manually per docs/ARCHITECTURE.md's verification notes, not re-proven
// here. Needs Postgres (capability checks hit capability_grants).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { pool } from "../src/db/pool.js";
import { veramoAgent } from "../src/identity/veramoAgent.js";
import { issueCapabilityGrant } from "../src/identity/capabilities.js";
import { mcpServer } from "../src/mcp/server.js";

let issuerDid: string;
let issuerNodeId: string;
let client: Client;

beforeAll(async () => {
  const issuer = await veramoAgent.didManagerCreate({ provider: "did:key" });
  issuerDid = issuer.did;
  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node-mcp', true) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await pool.query("DELETE FROM capability_grants WHERE issuer_node_id = $1", [issuerNodeId]);
  await pool.query("DELETE FROM verifiable_credentials WHERE issuer_did = $1", [issuerNodeId ? issuerDid : ""]);
  await pool.query("DELETE FROM nodes WHERE id = $1", [issuerNodeId]);
  await pool.end();
});

describe("whoami / list_capabilities over MCP (InMemoryTransport)", () => {
  it("allows whoami for a caller holding tier 0+", async () => {
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });
    const { jwt } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:whoami",
      tier: 0,
    });

    const result = await client.callTool({ name: "whoami", arguments: { credentialJwt: jwt } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text).did).toBe(subject.did);
  });

  it("denies whoami for a caller with no grant at all", async () => {
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });
    // A credential for a *different* capability, never for mcp:tool:whoami.
    const { jwt } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:something-unrelated",
      tier: 4,
    });

    const result = await client.callTool({ name: "whoami", arguments: { credentialJwt: jwt } });
    expect(result.isError).toBe(true);
  });

  it("list_capabilities returns exactly the grants held by the caller's own DID", async () => {
    const subject = await veramoAgent.didManagerCreate({ provider: "did:key" });
    await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:list_capabilities",
      tier: 0,
    });
    await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:some-other-thing",
      tier: 2,
    });
    // The credential actually presented for this call is the one for
    // list_capabilities itself -- issue a fresh one to use as the bearer.
    const { jwt: presented } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid: subject.did,
      capability: "mcp:tool:list_capabilities",
      tier: 0,
    });

    const result = await client.callTool({ name: "list_capabilities", arguments: { credentialJwt: presented } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "[]";
    const grants = JSON.parse(text) as { capability: string }[];
    const capabilities = grants.map((g) => g.capability);
    expect(capabilities).toContain("mcp:tool:list_capabilities");
    expect(capabilities).toContain("mcp:tool:some-other-thing");
  });
});
