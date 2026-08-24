// Re-expressed from v1's users domain logic -- requirements baseline,
// not copied code, with one deliberate deviation by explicit instruction:
// v1 checks a bare `role` column directly for dashboard authorization --
// the same trusted-role-column pattern already removed from
// crew_members. Here, `role` stays a descriptive/display column only
// (same convention crew_members.role follows); real authorization is a
// capability grant on the user's own custodially-held DID, checked via
// checkStandingCapability -- same mechanism, same zero-trust guarantee,
// as crew role authority.
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { didWebForDomain } from "../identity/did.js";
import { generateAndStoreKeyPair } from "../identity/keys.js";
import { hashPassword, verifyPassword } from "../identity/passwords.js";
import { getOrCreateSelfNode } from "../identity/node.js";
import { issueCapabilityGrant, checkStandingCapability } from "../identity/capabilities.js";

export type DashboardRole = "admin" | "staff" | "owner";

export type User = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  did: string;
  role: DashboardRole;
  active: boolean;
  created_at: string;
};

export type PublicUser = Omit<User, "password_hash">;

function toPublicUser(user: User): PublicUser {
  const { password_hash: _passwordHash, ...rest } = user;
  return rest;
}

// owner is admin-equivalent-or-greater everywhere on the dashboard, same
// as v1 -- gets both grants, matching crew_members' owner-implies-
// management convention.
const ROLE_CAPABILITIES: Record<DashboardRole, string[]> = {
  staff: ["dashboard:role:staff"],
  admin: ["dashboard:role:staff", "dashboard:role:admin"],
  owner: ["dashboard:role:staff", "dashboard:role:admin"],
};

// Key generation, the password hash, the role capability grants, and the
// users row all happen in one transaction -- same reasoning as
// registerCrewMember: a failure partway through (a duplicate email, a
// crash) must never leave a stranded DID with real credentials and no
// owning users row.
export async function registerUser(args: { email: string; name: string; password: string; role?: DashboardRole }): Promise<PublicUser> {
  const role = args.role ?? "staff";
  const id = randomUUID();
  const domain = process.env.NODE_DID_DOMAIN;
  if (!domain) throw new Error("NODE_DID_DOMAIN is required to issue a user's DID");
  const did = `${didWebForDomain(domain)}:users:${id}`;
  const selfNode = await getOrCreateSelfNode();
  const passwordHash = await hashPassword(args.password);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await generateAndStoreKeyPair(did, client);

    for (const capability of ROLE_CAPABILITIES[role]) {
      await issueCapabilityGrant({ issuerDid: selfNode.did, issuerNodeId: selfNode.id, subjectDid: did, capability, tier: 1 }, client);
    }

    const result = await client.query(
      `INSERT INTO users (id, email, name, password_hash, did, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, args.email, args.name, passwordHash, did, role],
    );
    await client.query("COMMIT");
    return toPublicUser(result.rows[0] as User);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return (result.rows[0] as User) ?? null;
}

export async function getUser(id: string): Promise<PublicUser | null> {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] ? toPublicUser(result.rows[0] as User) : null;
}

export async function listUsers(filter?: { active?: boolean }): Promise<PublicUser[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.active !== undefined) {
    params.push(filter.active);
    conditions.push(`active = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM users ${where} ORDER BY name`, params);
  return (result.rows as User[]).map(toPublicUser);
}

// No DELETE route, same as v1 -- deactivate only, to avoid orphaning
// alerts.resolved_by_user_id/notifications.acknowledged_by_user_id
// foreign keys.
export async function deactivateUser(id: string): Promise<PublicUser | null> {
  const result = await pool.query("UPDATE users SET active = false WHERE id = $1 RETURNING *", [id]);
  return result.rows[0] ? toPublicUser(result.rows[0] as User) : null;
}

// Admin-only, no current-password re-verification -- same as v1 (an
// admin resets someone else's, or their own, password directly).
export async function resetUserPassword(id: string, newPassword: string): Promise<PublicUser | null> {
  const passwordHash = await hashPassword(newPassword);
  const result = await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1 RETURNING *", [id, passwordHash]);
  return result.rows[0] ? toPublicUser(result.rows[0] as User) : null;
}

// Restoring Settings, Slice Q: real self-service password change --
// unlike resetUserPassword (admin-only, no current-password check),
// this is the user changing their own, so it re-verifies the current
// password first via the same hash-check the login route already uses.
export type ChangeOwnPasswordResult = { ok: true } | { ok: false; reason: "not_found" | "wrong_password" };

export async function changeOwnPassword(id: string, currentPassword: string, newPassword: string): Promise<ChangeOwnPasswordResult> {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  const user = result.rows[0] as User | undefined;
  if (!user) return { ok: false, reason: "not_found" };

  const valid = await verifyPassword(currentPassword, user.password_hash);
  if (!valid) return { ok: false, reason: "wrong_password" };

  const passwordHash = await hashPassword(newPassword);
  await pool.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, passwordHash]);
  return { ok: true };
}

export async function hasAdminCapability(userDid: string): Promise<boolean> {
  const check = await checkStandingCapability(userDid, "dashboard:role:admin", 1);
  return check.allowed;
}

export async function hasStaffCapability(userDid: string): Promise<boolean> {
  const check = await checkStandingCapability(userDid, "dashboard:role:staff", 1);
  return check.allowed;
}
