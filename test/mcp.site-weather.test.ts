// get_site_weather, over a real MCP call and a real Open-Meteo request --
// same "real external call, no mocking" convention as the existing
// forward-geocoding test (test/facade.locations.test.ts), and the same
// sovereignty-tier decision (weather_forecast, already external_accepted).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { pool } from "../src/db/pool.js";
import { didWebForAgent } from "../src/identity/did.js";
import { deleteKeyPair, generateAndStoreKeyPair } from "../src/identity/keys.js";
import { issueCapabilityGrant } from "../src/identity/capabilities.js";
import { registerSite } from "../src/domain/sites.js";
import { mcpServer } from "../src/mcp/server.js";

let issuerDid: string;
let issuerNodeId: string;
let client: Client;
let siteId: string;
let siteNoCoordsId: string;
const testDids: string[] = [];
const createdSiteIds: string[] = [];

beforeAll(async () => {
  issuerDid = didWebForAgent("id.dcentral-fieldops.test", "site-weather-mcp-test-issuer");
  await generateAndStoreKeyPair(issuerDid);
  testDids.push(issuerDid);

  const nodeRow = await pool.query(
    `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'test-node-site-weather', false) RETURNING id`,
    [issuerDid],
  );
  issuerNodeId = nodeRow.rows[0].id;

  const site = await registerSite({ name: "QA MCP Weather Site", type: "job_site", centerLat: 45.4215, centerLng: -75.6972 });
  siteId = site.id;
  createdSiteIds.push(site.id);

  const siteNoCoords = await registerSite({ name: "QA MCP Weather Site No Coords", type: "job_site" });
  siteNoCoordsId = siteNoCoords.id;
  createdSiteIds.push(siteNoCoords.id);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test-client", version: "0.1.0" });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
});

afterAll(async () => {
  await pool.query("DELETE FROM capability_grants WHERE issuer_node_id = $1", [issuerNodeId]);
  await pool.query("DELETE FROM verifiable_credentials WHERE issuer_did = $1", [issuerDid]);
  await pool.query("DELETE FROM nodes WHERE id = $1", [issuerNodeId]);
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

describe("get_site_weather over real MCP calls", () => {
  it("returns a real forecast for a site with coordinates", async () => {
    const jwt = await agentGrant("mcp-weather-reader", "mcp:tool:get_site_weather", 0);
    const result = await client.callTool({ name: "get_site_weather", arguments: { credentialJwt: jwt, siteId } });
    expect(result.isError).toBeFalsy();
    const weather = JSON.parse((result.content as { type: string; text: string }[])[0].text);
    expect(weather.siteName).toBe("QA MCP Weather Site");
    expect(typeof weather.summary).toBe("string");
    expect(typeof weather.tempMaxC).toBe("number");
    expect(typeof weather.tempMinC).toBe("number");
    expect(typeof weather.precipitationProbabilityMax).toBe("number");
    expect(typeof weather.windSpeedMaxKmh).toBe("number");
  });

  it("errors for a site with no stored coordinates", async () => {
    const jwt = await agentGrant("mcp-weather-reader", "mcp:tool:get_site_weather", 0);
    const result = await client.callTool({ name: "get_site_weather", arguments: { credentialJwt: jwt, siteId: siteNoCoordsId } });
    expect(result.isError).toBe(true);
  });
});
