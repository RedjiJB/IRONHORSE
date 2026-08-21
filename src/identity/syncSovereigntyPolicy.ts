// Reads policy/sovereignty_tiers.yaml (the git-tracked, human-reviewed
// source of truth) and upserts it into the sovereignty_tiers table (the
// runtime mirror the MCP invocation middleware actually reads). Run this
// after every edit to the YAML file -- the DB table is never edited
// directly. See docs/ARCHITECTURE.md "Sovereignty-tiering policy".
import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { pool } from "../db/pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const POLICY_PATH = join(__dirname, "..", "..", "policy", "sovereignty_tiers.yaml");

type PolicyFunction = {
  id: string;
  description: string;
  status: "external_accepted" | "external_pending" | "self_hosted_required" | "self_hosted_planned";
  rationale: string;
};

type PolicyFile = {
  version: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  functions: PolicyFunction[];
};

async function main() {
  const raw = readFileSync(POLICY_PATH, "utf8");
  const policy = parseYaml(raw) as PolicyFile;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const fn of policy.functions) {
      await client.query(
        `INSERT INTO sovereignty_tiers (id, description, status, rationale, reviewed_by, reviewed_at, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (id) DO UPDATE SET
           description = EXCLUDED.description,
           status = EXCLUDED.status,
           rationale = EXCLUDED.rationale,
           reviewed_by = EXCLUDED.reviewed_by,
           reviewed_at = EXCLUDED.reviewed_at,
           synced_at = now()`,
        [fn.id, fn.description.trim(), fn.status, fn.rationale.trim(), policy.reviewed_by, policy.reviewed_at],
      );
    }
    await client.query("COMMIT");
    console.log(`Synced ${policy.functions.length} sovereignty-tier entries.`);
    if (!policy.reviewed_by) {
      console.warn(
        "WARNING: policy/sovereignty_tiers.yaml has never been reviewed (reviewed_by is null). " +
          "Per the Phase 1 plan, this must be reviewed and approved before any Phase 2 domain logic depends on an external function.",
      );
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
