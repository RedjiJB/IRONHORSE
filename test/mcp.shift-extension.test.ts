// submit_shift_extension -> approve_pending_confirmation, over real MCP
// calls -- same shape as mcp.timeclock-confirmations.test.ts: a tier-2
// agent can submit an extension request but not approve it; a tier-3
// agent can approve, and the resulting shifts row is real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { pool } from "../src/db/pool.js";
import { didWebForAgent } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair } from "../src/identity/keys.js";
import { issueCapabilityGrant } from "../src/identity/capabilities.js";
import { registerSite } from "../src/domain/sites.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { assignShift } from "../src/domain/shifts.js";
import { mcpServer } from "../src/mcp/server.js";

let issuerDid: string;
let issuerNodeId: string;
let client: Client;
let siteId: string;
let crewMemberId: string;
let managerCrewMemberId: string;
const testDids: string[] = [];
const createdSiteIds: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdShiftIds: string[] = [];

beforeAll(async () => {
  issuerDid = didWebForAgent("id.dcentral-fieldops.test", "shift-ext-mcp-test-issuer");
  await generateAndStoreKeyPair(issuerDid);
  testDids.push(issuerDid);

  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node-shift-ext', false) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;

  const site = await registerSite({
    name: "QA MCP Shift Extension Site",
    type: "job_site",
    centerLat: 45.4215,
    centerLng: -75.6972,
    geofenceRadiusM: 100,
  });
  siteId = site.id;
  createdSiteIds.push(site.id);

  const crew = await registerCrewMember({ name: "QA MCP Shift Ext Crew", phone: "+15559990801" });
  crewMemberId = crew.id;
  createdCrewIds.push(crew.id);
  createdCrewDids.push(crew.did);

  const manager = await registerCrewMember({ name: "QA MCP Shift Ext Manager", phone: "+15559990802", role: "management" });
  managerCrewMemberId = manager.id;
  createdCrewIds.push(manager.id);
  createdCrewDids.push(manager.did);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await pool.query("DELETE FROM pending_confirmations WHERE submitted_by = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM shifts WHERE id = ANY($1)", [createdShiftIds]);
  await pool.query("DELETE FROM capability_grants WHERE issuer_node_id = $1 OR subject_did = ANY($2)", [issuerNodeId, createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE issuer_did = $1 OR subject_did = ANY($2)", [issuerDid, createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM nodes WHERE id = $1", [issuerNodeId]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
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

async function newShift(): Promise<string> {
  const shift = await assignShift({ crewMemberId, siteId, date: "2026-09-01", startTime: "08:00", endTime: "16:00" });
  createdShiftIds.push(shift.id);
  return shift.id;
}

describe("submit_shift_extension -> approve_pending_confirmation, over real MCP calls", () => {
  it("a tier-2 agent can submit but is denied approving its own submission (tier 3 required)", async () => {
    const shiftId = await newShift();
    const dispatchJwt = await agentGrant("mcp-dispatch-agent", "mcp:tool:submit_shift_extension", 2);

    const submitResult = await client.callTool({
      name: "submit_shift_extension",
      arguments: { credentialJwt: dispatchJwt, shiftId, crewMemberId, newEndTime: "18:00", reason: "running behind" },
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

  it("a tier-3 agent can approve, and the shift's end_time is actually updated", async () => {
    const shiftId = await newShift();
    const dispatchJwt = await agentGrant("mcp-dispatch-agent", "mcp:tool:submit_shift_extension", 2);
    const adminJwt = await agentGrant("mcp-admin-agent", "mcp:tool:approve_pending_confirmation", 3);

    const submitResult = await client.callTool({
      name: "submit_shift_extension",
      arguments: { credentialJwt: dispatchJwt, shiftId, crewMemberId, newEndTime: "19:30" },
    });
    const { pendingConfirmationId } = JSON.parse((submitResult.content as { type: string; text: string }[])[0].text);

    const approveResult = await client.callTool({
      name: "approve_pending_confirmation",
      arguments: { credentialJwt: adminJwt, id: pendingConfirmationId, reviewerCrewMemberId: managerCrewMemberId },
    });
    expect(approveResult.isError).toBeFalsy();
    const confirmation = JSON.parse((approveResult.content as { type: string; text: string }[])[0].text);
    expect(confirmation.status).toBe("approved");
    expect(confirmation.result_id).toBe(shiftId);

    const shiftRow = await pool.query("SELECT end_time FROM shifts WHERE id = $1", [shiftId]);
    expect(String(shiftRow.rows[0].end_time)).toContain("19:30");
  });

  it("a tier-3 agent's approval is still denied at the domain layer if reviewerCrewMemberId isn't management/owner", async () => {
    const shiftId = await newShift();
    const dispatchJwt = await agentGrant("mcp-dispatch-agent", "mcp:tool:submit_shift_extension", 2);
    const adminJwt = await agentGrant("mcp-admin-agent", "mcp:tool:approve_pending_confirmation", 3);

    const submitResult = await client.callTool({
      name: "submit_shift_extension",
      arguments: { credentialJwt: dispatchJwt, shiftId, crewMemberId, newEndTime: "20:00" },
    });
    const { pendingConfirmationId } = JSON.parse((submitResult.content as { type: string; text: string }[])[0].text);

    const approveAttempt = await client.callTool({
      name: "approve_pending_confirmation",
      arguments: { credentialJwt: adminJwt, id: pendingConfirmationId, reviewerCrewMemberId: crewMemberId },
    });
    expect(approveAttempt.isError).toBe(true);
    const text = (approveAttempt.content as { type: string; text: string }[])[0].text;
    expect(text).toContain("reviewer_not_management");
  });
});
