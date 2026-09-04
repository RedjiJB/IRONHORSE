// One-time provisioning for the OpenClaw WhatsApp gateway's own agent
// identity -- a real row in agent_identities (see 0001_nodes_and_agents.sql),
// not a crew member or dashboard user. Mints a single shared service
// credential the gateway attaches to every MCP call via the
// x-capability-grant header (src/mcp/transports/http.ts); the LLM never
// sees this JWT. Tier 2, wildcard capability -- deliberately excludes
// every tier-3 (money/schedule/inventory-committing) and tier-4
// (admin/financial) tool; matches v1's actual crew-facing tool surface
// (timeclock, consumable/asset/mileage/checkout submissions, shift
// confirmation), all of which sit at tier <=2. Per the standing
// role-capability convention this project already uses (see
// registerCrewMember's ROLE_CAPABILITIES grants), no expiry is set --
// revocation via revokeCapabilityGrant is the intended safety valve, not
// a TTL that could silently take WhatsApp down.
//
// Idempotent: safe to rerun. If the agent identity and a live grant
// already exist, prints the existing DID and exits without minting a new
// grant (a second run intended to force-rotate should revoke the old
// grant first, then rerun this).
import "dotenv/config";
import { pool } from "../db/pool.js";
import { didWebForAgent } from "./did.js";
import { generateAndStoreKeyPair } from "./keys.js";
import { getOrCreateSelfNode } from "./node.js";
import { issueCapabilityGrant } from "./capabilities.js";

const AGENT_ROLE = "openclaw-gateway";

async function main() {
  const domain = process.env.NODE_DID_DOMAIN;
  if (!domain) throw new Error("NODE_DID_DOMAIN is required to mint the OpenClaw agent's identity");
  const did = didWebForAgent(domain, AGENT_ROLE);
  const selfNode = await getOrCreateSelfNode();

  const existingAgent = await pool.query("SELECT id FROM agent_identities WHERE did = $1", [did]);
  if (existingAgent.rows[0]) {
    const existingGrant = await pool.query(
      `SELECT cg.id FROM capability_grants cg
       WHERE cg.subject_did = $1 AND cg.capability = '*' AND cg.revoked_at IS NULL
       ORDER BY cg.id DESC LIMIT 1`,
      [did],
    );
    if (existingGrant.rows[0]) {
      console.log(`Agent already provisioned: ${did}`);
      console.log("A live grant already exists -- not minting a new one. To rotate, revoke it first (revokeCapabilityGrant), then rerun this script.");
      return;
    }
    // Agent identity row exists but has no live grant (e.g. prior run was
    // interrupted, or the grant was revoked) -- mint a fresh grant only.
    const { jwt } = await issueCapabilityGrant({
      issuerDid: selfNode.did,
      issuerNodeId: selfNode.id,
      subjectDid: did,
      capability: "*",
      tier: 2,
    });
    console.log(`Agent identity: ${did}`);
    console.log(`New capability grant JWT (tier 2, wildcard -- store this on the OpenClaw box, never in git):\n${jwt}`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await generateAndStoreKeyPair(did, client);
    const agentRow = await client.query(
      `INSERT INTO agent_identities (node_id, did, role, display_name) VALUES ($1, $2, $3, $4) RETURNING id`,
      [selfNode.id, did, AGENT_ROLE, "OpenClaw WhatsApp Gateway"],
    );
    const { jwt } = await issueCapabilityGrant(
      { issuerDid: selfNode.did, issuerNodeId: selfNode.id, subjectDid: did, capability: "*", tier: 2 },
      client,
    );
    await client.query("COMMIT");
    console.log(`Agent identity created: ${did} (id: ${agentRow.rows[0].id})`);
    console.log(`Capability grant JWT (tier 2, wildcard -- store this on the OpenClaw box, never in git):\n${jwt}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
