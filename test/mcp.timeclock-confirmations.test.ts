// Phase 2 slice 3 verification, at the MCP layer this time (not just the
// domain layer test/domain.timeclock-confirmations.test.ts already
// covers): proves the actual tool registration + capability-tier gating
// wiring is correct, not just the underlying business logic. A dispatch
// agent holding only a tier-2 grant can submit a timeclock event but is
// denied approve_pending_confirmation (tier 3); a separate admin agent
// holding a tier-3 grant can approve it end to end through real MCP tool
// calls.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { pool } from "../src/db/pool.js";
import { didWebForAgent } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair } from "../src/identity/keys.js";
import { issueCapabilityGrant } from "../src/identity/capabilities.js";
import { registerSite } from "../src/domain/sites.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
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

beforeAll(async () => {
  issuerDid = didWebForAgent("id.dcentral-fieldops.test", "timeclock-mcp-test-issuer");
  await generateAndStoreKeyPair(issuerDid);
  testDids.push(issuerDid);

  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node-timeclock', false) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;

  const site = await registerSite({
    name: "QA MCP Timeclock Site",
    type: "job_site",
    centerLat: 45.4215,
    centerLng: -75.6972,
    geofenceRadiusM: 100,
  });
  siteId = site.id;
  createdSiteIds.push(site.id);

  const crew = await registerCrewMember({ name: "QA MCP Timeclock Crew", phone: "+15559990701" });
  crewMemberId = crew.id;
  createdCrewIds.push(crew.id);

  const manager = await registerCrewMember({ name: "QA MCP Timeclock Manager", phone: "+15559990702", role: "management" });
  managerCrewMemberId = manager.id;
  createdCrewIds.push(manager.id);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await pool.query("DELETE FROM timeclock_entries WHERE crew_member_id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM pending_confirmations WHERE submitted_by = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM capability_grants WHERE issuer_node_id = $1", [issuerNodeId]);
  await pool.query("DELETE FROM verifiable_credentials WHERE issuer_did = $1", [issuerDid]);
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

describe("log_timeclock_event -> approve_pending_confirmation, over real MCP calls", () => {
  it("a tier-2 agent can submit but is denied approving its own submission (tier 3 required)", async () => {
    const dispatchJwt = await agentGrant("mcp-dispatch-agent", "mcp:tool:log_timeclock_event", 2);

    const submitResult = await client.callTool({
      name: "log_timeclock_event",
      arguments: { credentialJwt: dispatchJwt, crewMemberId, eventType: "in", siteId, lat: 45.4215, lng: -75.6972 },
    });
    expect(submitResult.isError).toBeFalsy();
    const submitText = (submitResult.content as { type: string; text: string }[])[0].text;
    const { status, pendingConfirmationId } = JSON.parse(submitText);
    expect(status).toBe("awaiting_review");
    expect(pendingConfirmationId).toBeTruthy();

    // The same dispatch agent only ever held a tier-2 grant for
    // log_timeclock_event -- it holds nothing at all for
    // approve_pending_confirmation, so this must be denied regardless of
    // reviewerCrewMemberId's own real-world role.
    const approveAttempt = await client.callTool({
      name: "approve_pending_confirmation",
      arguments: { credentialJwt: dispatchJwt, id: pendingConfirmationId, reviewerCrewMemberId: managerCrewMemberId },
    });
    expect(approveAttempt.isError).toBe(true);
  });

  it("a tier-3 agent can approve, and the resulting timeclock_entries row is real", async () => {
    const dispatchJwt = await agentGrant("mcp-dispatch-agent", "mcp:tool:log_timeclock_event", 2);
    const adminJwt = await agentGrant("mcp-admin-agent", "mcp:tool:approve_pending_confirmation", 3);

    const submitResult = await client.callTool({
      name: "log_timeclock_event",
      arguments: { credentialJwt: dispatchJwt, crewMemberId, eventType: "in", siteId, lat: 45.4215, lng: -75.6972 },
    });
    const { pendingConfirmationId } = JSON.parse((submitResult.content as { type: string; text: string }[])[0].text);

    const approveResult = await client.callTool({
      name: "approve_pending_confirmation",
      arguments: { credentialJwt: adminJwt, id: pendingConfirmationId, reviewerCrewMemberId: managerCrewMemberId },
    });
    expect(approveResult.isError).toBeFalsy();
    const confirmation = JSON.parse((approveResult.content as { type: string; text: string }[])[0].text);
    expect(confirmation.status).toBe("approved");

    const listResult = await client.callTool({
      name: "list_timeclock_entries",
      arguments: { credentialJwt: await agentGrant("mcp-reader-agent", "mcp:tool:list_timeclock_entries", 0), crewMemberId },
    });
    const entries = JSON.parse((listResult.content as { type: string; text: string }[])[0].text);
    expect(entries.some((e: { id: string }) => e.id === confirmation.result_id)).toBe(true);
  });

  it("a tier-3 agent's approval is still denied at the domain layer if reviewerCrewMemberId isn't management/owner", async () => {
    const dispatchJwt = await agentGrant("mcp-dispatch-agent", "mcp:tool:log_timeclock_event", 2);
    const adminJwt = await agentGrant("mcp-admin-agent", "mcp:tool:approve_pending_confirmation", 3);

    const submitResult = await client.callTool({
      name: "log_timeclock_event",
      arguments: { credentialJwt: dispatchJwt, crewMemberId, eventType: "out", siteId, lat: 45.4215, lng: -75.6972 },
    });
    const { pendingConfirmationId } = JSON.parse((submitResult.content as { type: string; text: string }[])[0].text);

    // The MCP-layer tier check on the agent passes (tier 3, correct
    // capability) -- but reviewerCrewMemberId here is the ordinary crew
    // member, not a management/owner one, so the domain-layer check inside
    // approveConfirmation must still deny it. Proves the two gates are
    // genuinely independent, not one masking the other.
    const approveAttempt = await client.callTool({
      name: "approve_pending_confirmation",
      arguments: { credentialJwt: adminJwt, id: pendingConfirmationId, reviewerCrewMemberId: crewMemberId },
    });
    expect(approveAttempt.isError).toBe(true);
    const text = (approveAttempt.content as { type: string; text: string }[])[0].text;
    expect(text).toContain("reviewer_not_management");
  });
});
