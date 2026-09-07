// Guards are DID-based identities from registration onward -- IRONHORSE
// inherited the full D-Central identity stack as-is (Phase 0 decision, see
// ROADMAP.md), unlike dcentral-fieldops's crew_members which started
// phone-only and added DIDs in a later migration. The DID is custodially
// held (this node generates and stores the keypair) -- a guard interacts
// through the mobile app with no wallet of their own, phone stays the
// column day-to-day contact/login identity actually keys off of, and is
// also a signed PhoneBinding credential bound to the guard's DID, not just
// a plain database value.
import { randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";
import { didWebForDomain } from "../identity/did.js";
import { generateAndStoreKeyPair } from "../identity/keys.js";
import { getOrCreateSelfNode } from "../identity/node.js";
import { issuePhoneBindingJwt } from "../identity/vc.js";
import { issueCapabilityGrant, checkStandingCapability } from "../identity/capabilities.js";

export type GuardRole = "guard" | "supervisor" | "admin";

export type Guard = {
  id: string;
  name: string;
  phone: string;
  role: GuardRole;
  did: string;
  active: boolean;
  preferred_language: string | null;
  created_at: string;
  deactivated_at: string | null;
};

// Roles that hold real authority (e.g. approving a confirm-before-execute
// action, per FEATURES.md §3's supervisor approve/reject queue) get a real
// capability grant on their DID, not just a role string -- 'admin' also
// gets 'guard:role:management', matching the precedent's documented
// convention that its top role is management-equivalent-or-greater
// wherever a management check happens.
const ROLE_CAPABILITIES: Partial<Record<GuardRole, string[]>> = {
  supervisor: ["guard:role:management"],
  admin: ["guard:role:management", "guard:role:admin"],
};

// Key generation, the PhoneBinding credential, any role capability grants,
// and the guards row all happen in one transaction -- otherwise a failure
// partway through (e.g. a duplicate phone number on the final insert)
// leaves a stranded DID with a real private key and signed credentials but
// no owning guards row, which then collides with any future attempt to
// reuse that state.
export async function registerGuard(args: { name: string; phone: string; role?: GuardRole }): Promise<Guard> {
  const role = args.role ?? "guard";
  const id = randomUUID();
  const domain = process.env.NODE_DID_DOMAIN;
  if (!domain) throw new Error("NODE_DID_DOMAIN is required to issue a guard's DID");
  const did = `${didWebForDomain(domain)}:guards:${id}`;
  const selfNode = await getOrCreateSelfNode();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await generateAndStoreKeyPair(did, client);

    const jwt = await issuePhoneBindingJwt({ issuerDid: selfNode.did, subjectDid: did, phone: args.phone });
    await client.query(
      `INSERT INTO verifiable_credentials (jwt, issuer_did, subject_did, credential_type, issued_at)
       VALUES ($1, $2, $3, 'PhoneBinding', now())`,
      [jwt, selfNode.did, did],
    );

    for (const capability of ROLE_CAPABILITIES[role] ?? []) {
      await issueCapabilityGrant({ issuerDid: selfNode.did, issuerNodeId: selfNode.id, subjectDid: did, capability, tier: 1 }, client);
    }

    const result = await client.query(
      `INSERT INTO guards (id, name, phone, role, did) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [id, args.name, args.phone, role, did],
    );
    await client.query("COMMIT");
    return result.rows[0] as Guard;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listGuards(filter?: { role?: GuardRole; active?: boolean }): Promise<Guard[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.role) {
    params.push(filter.role);
    conditions.push(`role = $${params.length}`);
  }
  if (filter?.active !== undefined) {
    params.push(filter.active);
    conditions.push(`active = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM guards ${where} ORDER BY name`, params);
  return result.rows as Guard[];
}

// Shared by duress.ts's triggerDuressAlert and messages.ts's
// contactSupervisor -- both page every active supervisor/admin
// system-wide, the documented simplification (DOMAIN-DESIGN.md §3) for
// "every supervisor overseeing that site" until site-level supervisor
// assignment exists.
export async function listActiveSupervisorsAndAdmins(): Promise<Guard[]> {
  return (await listGuards({ role: "supervisor", active: true })).concat(
    await listGuards({ role: "admin", active: true }),
  );
}

export async function getGuard(id: string): Promise<Guard | null> {
  const result = await pool.query("SELECT * FROM guards WHERE id = $1", [id]);
  return (result.rows[0] as Guard) ?? null;
}

export async function getGuardByPhone(phone: string): Promise<Guard | null> {
  const result = await pool.query("SELECT * FROM guards WHERE phone = $1", [phone]);
  return (result.rows[0] as Guard) ?? null;
}

export type GuardWithLatestShift = Guard & { on_duty_site_id: string | null };

// Basis for the supervisor live-roster view (FEATURES.md §3:
// "on duty, post, clocked-in status, last location") -- which site (if
// any) a guard currently has an unmatched 'in' event for, most recent
// event first. A guard whose most recent event today is 'out' (or who has
// no event today) is not on duty.
export async function listGuardsWithOnDutyStatus(filter?: { active?: boolean }): Promise<GuardWithLatestShift[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.active !== undefined) {
    params.push(filter.active);
    conditions.push(`g.active = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(
    `SELECT g.*,
       CASE WHEN t.event_type = 'in' THEN t.site_id ELSE NULL END AS on_duty_site_id
     FROM guards g
     LEFT JOIN LATERAL (
       SELECT event_type, site_id
       FROM timeclock_entries te
       WHERE te.guard_id = g.id AND te."timestamp" >= date_trunc('day', now())
       ORDER BY te."timestamp" DESC
       LIMIT 1
     ) t ON true
     ${where}
     ORDER BY g.name`,
    params,
  );
  return result.rows as GuardWithLatestShift[];
}

// Replaces a plain "isSupervisorRole(reviewer.role)" string check -- a role
// column is exactly the kind of implicitly-trusted, non-cryptographically-
// verified state a zero-trust design pushes back against. This re-verifies
// a real capability grant's signature (via checkStandingCapability) rather
// than trusting whatever guards.role happens to say.
export async function hasSupervisorCapability(guardDid: string): Promise<boolean> {
  const check = await checkStandingCapability(guardDid, "guard:role:management", 1);
  return check.allowed;
}
