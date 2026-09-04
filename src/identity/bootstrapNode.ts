// Explicit entry point for creating (or confirming) the self node's
// identity -- getOrCreateSelfNode() does this lazily on first use from
// anywhere in the app, but this script exists so it can be triggered and
// observed deliberately, e.g. right after a fresh deploy, before anything
// else tries to issue a credential from it.
import { getOrCreateSelfNode } from "./node.js";
import { pool } from "../db/pool.js";

async function main() {
  const self = await getOrCreateSelfNode();
  console.log(`Self node: ${self.did} (id: ${self.id})`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
