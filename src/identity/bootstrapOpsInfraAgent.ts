// One-time provisioning for this deployment's own infra-reporting agent
// identity -- a real agent_identities row (same mechanism as
// bootstrapOpenClawAgent.ts), used by host-side scripts (the nightly
// backup job, a health-check heartbeat) to report their own status via
// the systemHealth MCP tools. Unlike OpenClaw's single wildcard tier-2
// grant, this mints one narrowly-scoped tier-4 grant per specific
// report_* capability -- a backup script has no legitimate reason to
// hold a credential that could also, say, reset a password, so it
// doesn't get one. Idempotent: safe to rerun: only mints grants for
// capabilities that don't already have a live one.
import "dotenv/config";
import { pool } from "../db/pool.js";
import { didWebForAgent } from "./did.js";
import { generateAndStoreKeyPair } from "./keys.js";
import { getOrCreateSelfNode } from "./node.js";
import { issueCapabilityGrant } from "./capabilities.js";

const AGENT_ROLE = "ops-infra";
const CAPABILITIES = [
  "mcp:tool:report_backup_status",
  "mcp:tool:report_dashboard_health",
  "mcp:tool:report_connectivity_health",
  "mcp:tool:report_disk_health",
  "mcp:tool:report_cron_failure",
] as const;

async function main() {
  const domain = process.env.NODE_DID_DOMAIN;
  if (!domain) throw new Error("NODE_DID_DOMAIN is required to mint the ops-infra agent's identity");
  const did = didWebForAgent(domain, AGENT_ROLE);
  const selfNode = await getOrCreateSelfNode();

  const existingAgent = await pool.query("SELECT id FROM agent_identities WHERE did = $1", [did]);
  if (!existingAgent.rows[0]) {
    await generateAndStoreKeyPair(did);
    await pool.query(
      `INSERT INTO agent_identities (node_id, did, role, display_name) VALUES ($1, $2, $3, $4)`,
      [selfNode.id, did, AGENT_ROLE, "Ops Infra Reporting"],
    );
    console.log(`Agent identity created: ${did}`);
  } else {
    console.log(`Agent already provisioned: ${did}`);
  }

  for (const capability of CAPABILITIES) {
    const existingGrant = await pool.query(
      `SELECT id FROM capability_grants WHERE subject_did = $1 AND capability = $2 AND revoked_at IS NULL ORDER BY id DESC LIMIT 1`,
      [did, capability],
    );
    if (existingGrant.rows[0]) {
      console.log(`  ${capability}: live grant already exists, skipping`);
      continue;
    }
    const { jwt } = await issueCapabilityGrant({
      issuerDid: selfNode.did,
      issuerNodeId: selfNode.id,
      subjectDid: did,
      capability,
      tier: 4,
    });
    console.log(`  ${capability}:\n${jwt}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
