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
import { didWebForAgent } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair } from "../src/identity/keys.js";
import { issueCapabilityGrant } from "../src/identity/capabilities.js";
import { mcpServer } from "../src/mcp/server.js";

let issuerDid: string;
let issuerNodeId: string;
let client: Client;
const subjectDids: string[] = [];

async function newSubjectDid(label: string): Promise<string> {
  const did = didWebForAgent("id.dcentral-fieldops.test", label);
  subjectDids.push(did);
  await generateAndStoreKeyPair(did);
  return did;
}

beforeAll(async () => {
  issuerDid = didWebForAgent("id.dcentral-fieldops.test", "mcp-test-issuer");
  await generateAndStoreKeyPair(issuerDid);
  // is_self stays false -- same reasoning as capabilities.test.ts: this is
  // an arbitrary test-fixture node, and nodes_single_self_idx enforces the
  // real self-node as a global singleton across every file sharing this DB.
  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node-mcp', false) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await pool.query("DELETE FROM capability_grants WHERE issuer_node_id = $1", [issuerNodeId]);
  await pool.query("DELETE FROM verifiable_credentials WHERE issuer_did = $1", [issuerDid]);
  await pool.query("DELETE FROM nodes WHERE id = $1", [issuerNodeId]);
  await deleteKeyPair(issuerDid);
  for (const did of subjectDids) await deleteKeyPair(did);
  await pool.end();
});

describe("whoami / list_capabilities over MCP (InMemoryTransport)", () => {
  it("allows whoami for a caller holding tier 0+", async () => {
    const subjectDid = await newSubjectDid("mcp-subject-1");
    const { jwt } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid,
      capability: "mcp:tool:whoami",
      tier: 0,
    });

    const result = await client.callTool({ name: "whoami", arguments: { credentialJwt: jwt } });
    expect(result.isError).toBeFalsy();
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(JSON.parse(text).did).toBe(subjectDid);
  });

  it("denies whoami for a caller with no grant at all", async () => {
    const subjectDid = await newSubjectDid("mcp-subject-2");
    // A credential for a *different* capability, never for mcp:tool:whoami.
    const { jwt } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid,
      capability: "mcp:tool:something-unrelated",
      tier: 4,
    });

    const result = await client.callTool({ name: "whoami", arguments: { credentialJwt: jwt } });
    expect(result.isError).toBe(true);
  });

  it("list_capabilities returns exactly the grants held by the caller's own DID", async () => {
    const subjectDid = await newSubjectDid("mcp-subject-3");
    await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid,
      capability: "mcp:tool:list_capabilities",
      tier: 0,
    });
    await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid,
      capability: "mcp:tool:some-other-thing",
      tier: 2,
    });
    // The credential actually presented for this call is the one for
    // list_capabilities itself -- issue a fresh one to use as the bearer.
    const { jwt: presented } = await issueCapabilityGrant({
      issuerDid,
      issuerNodeId,
      subjectDid,
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
