// submit_spend_record -> approve_pending_confirmation, over real MCP
// calls -- same shape as mcp.shift-extension.test.ts. Covers the real
// gap found by reading Sod Boys' actual WhatsApp history: crew were
// emailing receipt photos for every purchase by hand because there was
// no crew-submittable spend record, only the tier-4 admin-only
// register_spend_record and the mileage-specific submit_mileage_claim.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { pool } from "../src/db/pool.js";
import { didWebForAgent } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair } from "../src/identity/keys.js";
import { issueCapabilityGrant } from "../src/identity/capabilities.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { mcpServer } from "../src/mcp/server.js";

let issuerDid: string;
let issuerNodeId: string;
let client: Client;
let crewMemberId: string;
let managerCrewMemberId: string;
const testDids: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdSpendRecordIds: string[] = [];

beforeAll(async () => {
  issuerDid = didWebForAgent("id.dcentral-fieldops.test", "spend-record-mcp-test-issuer");
  await generateAndStoreKeyPair(issuerDid);
  testDids.push(issuerDid);

  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node-spend-record', false) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;

  const crew = await registerCrewMember({ name: "QA MCP Spend Record Crew", phone: "+15559990901" });
  crewMemberId = crew.id;
  createdCrewIds.push(crew.id);
  createdCrewDids.push(crew.did);

  const manager = await registerCrewMember({ name: "QA MCP Spend Record Manager", phone: "+15559990902", role: "management" });
  managerCrewMemberId = manager.id;
  createdCrewIds.push(manager.id);
  createdCrewDids.push(manager.did);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await pool.query("DELETE FROM pending_confirmations WHERE submitted_by = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM spend_records WHERE id = ANY($1)", [createdSpendRecordIds]);
  await pool.query("DELETE FROM capability_grants WHERE issuer_node_id = $1 OR subject_did = ANY($2)", [issuerNodeId, createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE issuer_did = $1 OR subject_did = ANY($2)", [issuerDid, createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM nodes WHERE id = $1", [issuerNodeId]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  for (const did of testDids) await deleteKeyPair(did);
  await pool.end();
});

async function agentGrant(role: string, capability: string, tier: 0 | 1 | 2 | 3 | 4): Promise<string> {
  const did = didWebForAgent("id.dcentral-fieldops.test", role);
  if (!testDids.includes(did)) {
    testDids.push(did);
    await generateAndStoreKeyPair(did);
  }
  const { jwt } = await issueCapabilityGrant({ issuerDid, issuerNodeId, subjectDid: did, capability, tier });
  return jwt;
}

describe("submit_spend_record -> approve_pending_confirmation, over real MCP calls", () => {
  it("a tier-2 agent can submit but is denied approving its own submission (tier 3 required)", async () => {
    const dispatchJwt = await agentGrant("spend-record-dispatch-agent", "mcp:tool:submit_spend_record", 2);

    const submitResult = await client.callTool({
      name: "submit_spend_record",
      arguments: { credentialJwt: dispatchJwt, crewMemberId, category: "fuel", method: "company_card", amount: 42.5, description: "gas fill-up" },
    });
    expect(submitResult.isError).toBeFalsy();
    const { status, pendingConfirmationId } = JSON.parse((submitResult.content as { type: string; text: string }[])[0].text);
    expect(status).toBe("awaiting_review");
    expect(pendingConfirmationId).toBeTruthy();

    const approveAttempt = await client.callTool({
      name: "approve_pending_confirmation",
      arguments: { credentialJwt: dispatchJwt, id: pendingConfirmationId, reviewerCrewMemberId: managerCrewMemberId },
    });
    expect(approveAttempt.isError).toBe(true);
  });

  it("a tier-3 agent can approve, and a real approved spend_records row is created", async () => {
    const dispatchJwt = await agentGrant("spend-record-dispatch-agent", "mcp:tool:submit_spend_record", 2);
    const adminJwt = await agentGrant("spend-record-admin-agent", "mcp:tool:approve_pending_confirmation", 3);

    const submitResult = await client.callTool({
      name: "submit_spend_record",
      arguments: { credentialJwt: dispatchJwt, crewMemberId, category: "receipt", method: "cash", amount: 18.75, description: "hardware store" },
    });
    const { pendingConfirmationId } = JSON.parse((submitResult.content as { type: string; text: string }[])[0].text);

    const approveResult = await client.callTool({
      name: "approve_pending_confirmation",
      arguments: { credentialJwt: adminJwt, id: pendingConfirmationId, reviewerCrewMemberId: managerCrewMemberId },
    });
    expect(approveResult.isError).toBeFalsy();
    const confirmation = JSON.parse((approveResult.content as { type: string; text: string }[])[0].text);
    expect(confirmation.status).toBe("approved");
    createdSpendRecordIds.push(confirmation.result_id);

    const recordRow = await pool.query("SELECT status, amount, category, crew_member_id FROM spend_records WHERE id = $1", [confirmation.result_id]);
    expect(recordRow.rows[0].status).toBe("approved");
    expect(Number(recordRow.rows[0].amount)).toBe(18.75);
    expect(recordRow.rows[0].category).toBe("receipt");
    expect(recordRow.rows[0].crew_member_id).toBe(crewMemberId);
  });

  it("mileage is rejected by the input schema -- must use submit_mileage_claim instead", async () => {
    const dispatchJwt = await agentGrant("spend-record-dispatch-agent", "mcp:tool:submit_spend_record", 2);
    const submitResult = await client.callTool({
      name: "submit_spend_record",
      arguments: { credentialJwt: dispatchJwt, crewMemberId, category: "mileage", method: "personal_reimbursed", amount: 10 },
    });
    expect(submitResult.isError).toBe(true);
  });
});
