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

  // Insert the node row and generate/store its keypair in the same
  // transaction -- a real race found by CI (never surfaced locally,
  // since the self node here was bootstrapped once, long ago, and this
  // window never reopens): with two separate un-transacted statements, a
  // concurrent caller's re-read (the UNIQUE_VIOLATION retry path below)
  // could see the node row committed before the key was, and fail
  // downstream with "no private key stored." Now the row is never
  // visible to another connection until the key exists too -- either a
  // concurrent caller's INSERT hits nodes_single_self_idx (nothing
  // committed yet, so it correctly blocks until this transaction
  // resolves) or it doesn't exist at all yet, never a partial state.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO nodes (did, display_name, is_self) VALUES ($1, 'dcentral-fieldops (self)', true) RETURNING id, did`,
      [did],
    );
    await generateAndStoreKeyPair(did, client);
    await client.query("COMMIT");
    cached = inserted.rows[0] as SelfNode;
    return cached;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err && typeof err === "object" && "code" in err && err.code === UNIQUE_VIOLATION) {
      const retry = await pool.query("SELECT id, did FROM nodes WHERE is_self = true LIMIT 1");
      if (retry.rows[0]) {
        cached = retry.rows[0] as SelfNode;
        return cached;
      }
    }
    throw err;
  } finally {
    client.release();
  }
}
