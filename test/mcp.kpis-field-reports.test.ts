// get_kpis and create/list/get_field_report, over real MCP calls -- the
// last two tools from this batch that had domain code but no MCP
// exposure yet (both were façade-route-only, per the Dashboard
// Restoration/Field Reports plan).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { pool } from "../src/db/pool.js";
import { didWebForAgent } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair } from "../src/identity/keys.js";
import { issueCapabilityGrant } from "../src/identity/capabilities.js";
import { registerSite } from "../src/domain/sites.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { createTimeclockEntry } from "../src/domain/timeclock.js";
import { mcpServer } from "../src/mcp/server.js";

let issuerDid: string;
let issuerNodeId: string;
let client: Client;
let siteId: string;
let crewMemberId: string;
const testDids: string[] = [];
const createdSiteIds: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdFieldReportIds: string[] = [];

beforeAll(async () => {
  issuerDid = didWebForAgent("id.dcentral-fieldops.test", "kpis-fieldreports-mcp-test-issuer");
  await generateAndStoreKeyPair(issuerDid);
  testDids.push(issuerDid);

  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node-kpis-fieldreports', false) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;

  const site = await registerSite({ name: "QA MCP KPI/FieldReport Site", type: "job_site", centerLat: 45.4215, centerLng: -75.6972, geofenceRadiusM: 100 });
  siteId = site.id;
  createdSiteIds.push(site.id);

  const crew = await registerCrewMember({ name: "QA MCP KPI/FieldReport Crew", phone: "+15559991001" });
  crewMemberId = crew.id;
  createdCrewIds.push(crew.id);
  createdCrewDids.push(crew.did);

  // A real clocked-in-today event, so get_field_report's derived
  // workforce list has something real to find, and get_kpis' crew
  // utilization figure reflects a real row rather than only zeros.
  await createTimeclockEntry({ crewMemberId, eventType: "in", siteId, geofenceVerified: true, lat: 45.4215, lng: -75.6972 });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await pool.query("DELETE FROM field_reports WHERE id = ANY($1)", [createdFieldReportIds]);
  await pool.query("DELETE FROM timeclock_entries WHERE crew_member_id = ANY($1)", [createdCrewIds]);
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

describe("get_kpis over real MCP calls", () => {
  it("denies a tier-2 caller (management-level insight, not crew-facing)", async () => {
    const jwt = await agentGrant("kpi-crew-agent", "mcp:tool:get_kpis", 2);
    const result = await client.callTool({ name: "get_kpis", arguments: { credentialJwt: jwt } });
    expect(result.isError).toBe(true);
  });

  it("returns all five KPIs for a tier-3 caller, reflecting real data", async () => {
    const jwt = await agentGrant("kpi-management-agent", "mcp:tool:get_kpis", 3);
    const result = await client.callTool({ name: "get_kpis", arguments: { credentialJwt: jwt } });
    expect(result.isError).toBeFalsy();
    const kpis = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(kpis.crewUtilizationToday.clocked_in_today).toBeGreaterThanOrEqual(1);
    expect(kpis.openAlertsBySeverity).toHaveProperty("critical");
    expect(kpis.avgAlertResolutionTime).toHaveProperty("resolved_count");
    expect(Array.isArray(kpis.poSpendThisMonthByVendor)).toBe(true);
    expect(kpis.timeclockHoursThisWeek).toHaveProperty("total_hours");
  });
});

describe("create/list/get_field_report over real MCP calls", () => {
  it("creates a field report, lists it, and get_field_report resolves real derived workforce", async () => {
    const jwt = await agentGrant("field-report-agent", "mcp:tool:create_field_report", 2);
    const today = new Date().toISOString().slice(0, 10);

    const createResult = await client.callTool({
      name: "create_field_report",
      arguments: { credentialJwt: jwt, siteId, reportDate: today, notes: "Ripped and prepped the back yard, sod tomorrow." },
    });
    expect(createResult.isError).toBeFalsy();
    const report = JSON.parse((createResult.content as { type: string; text: string }[])[0].text);
    createdFieldReportIds.push(report.id);
    expect(report.site_id).toBe(siteId);
    expect(report.notes).toContain("Ripped and prepped");

    const listJwt = await agentGrant("field-report-reader", "mcp:tool:list_field_reports", 0);
    const listResult = await client.callTool({ name: "list_field_reports", arguments: { credentialJwt: listJwt, siteId } });
    const reports = JSON.parse((listResult.content as { type: string; text: string }[])[0].text);
    expect(reports.some((r: { id: string }) => r.id === report.id)).toBe(true);

    const getJwt = await agentGrant("field-report-reader2", "mcp:tool:get_field_report", 0);
    const getResult = await client.callTool({ name: "get_field_report", arguments: { credentialJwt: getJwt, id: report.id } });
    const full = JSON.parse((getResult.content as { type: string; text: string }[])[0].text);
    expect(full.workforce.some((w: { crew_member_id: string }) => w.crew_member_id === crewMemberId)).toBe(true);
  });
});
