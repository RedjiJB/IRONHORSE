// The self node's own identity -- bootstrapped lazily (idempotent, safe to
// call from anywhere that needs an issuer) rather than requiring a manual
// setup step nothing else can proceed without. See also
// src/identity/bootstrapNode.ts for the explicit npm run entry point, for
// when someone actually wants to trigger and observe this deliberately
// rather than have it happen invisibly on first use.
import "dotenv/config";
import { pool } from "../db/pool.js";
import { didWebForDomain } from "./did.js";
import { generateAndStoreKeyPair } from "./keys.js";

export type SelfNode = { id: string; did: string };

const UNIQUE_VIOLATION = "23505";

let cached: SelfNode | null = null;

export async function getOrCreateSelfNode(): Promise<SelfNode> {
  if (cached) return cached;

  const existing = await pool.query("SELECT id, did FROM nodes WHERE is_self = true LIMIT 1");
  if (existing.rows[0]) {
    cached = existing.rows[0] as SelfNode;
    return cached;
  }

  const domain = process.env.NODE_DID_DOMAIN;
  if (!domain) throw new Error("NODE_DID_DOMAIN is required to bootstrap the self node's identity");
  const did = didWebForDomain(domain);

  // Insert (and only then generate/store the keypair, not before) rather
  // than the reverse -- if two processes race to bootstrap the self node
  // at once (a real risk: multiple test files, or a future multi-instance
  // deploy, all calling this on first use), the loser's INSERT fails on
  // nodes_single_self_idx before it's generated any orphaned key material,
  // and just re-reads the winner's row instead.
  try {
    const inserted = await pool.query(
      `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'dcentral-fieldops (self)', true) RETURNING id, did`,
      [did],
    );
    cached = inserted.rows[0] as SelfNode;
    await generateAndStoreKeyPair(did);
    return cached;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === UNIQUE_VIOLATION) {
      const retry = await pool.query("SELECT id, did FROM nodes WHERE is_self = true LIMIT 1");
      if (retry.rows[0]) {
        cached = retry.rows[0] as SelfNode;
        return cached;
      }
    }
    throw err;
  }
}
