import { pool } from "../db/pool.js";

export type CrewRole = "crew" | "foreman" | "yard" | "management" | "owner" | "IT";
const MANAGEMENT_ROLES: CrewRole[] = ["management", "owner"];

export type CrewMember = {
  id: string;
  name: string;
  phone: string;
  role: CrewRole;
  active: boolean;
  preferred_language: string | null;
  created_at: string;
  deactivated_at: string | null;
};

export async function registerCrewMember(args: { name: string; phone: string; role?: CrewRole }): Promise<CrewMember> {
  const result = await pool.query(
    `INSERT INTO crew_members (name, phone, role) VALUES ($1, $2, $3) RETURNING *`,
    [args.name, args.phone, args.role ?? "crew"],
  );
  return result.rows[0] as CrewMember;
}

export async function listCrewMembers(filter?: { role?: CrewRole; active?: boolean }): Promise<CrewMember[]> {
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
  const result = await pool.query(`SELECT * FROM crew_members ${where} ORDER BY name`, params);
  return result.rows as CrewMember[];
}

export async function getCrewMember(id: string): Promise<CrewMember | null> {
  const result = await pool.query("SELECT * FROM crew_members WHERE id = $1", [id]);
  return (result.rows[0] as CrewMember) ?? null;
}

export async function getCrewMemberByPhone(phone: string): Promise<CrewMember | null> {
  const result = await pool.query("SELECT * FROM crew_members WHERE phone = $1", [phone]);
  return (result.rows[0] as CrewMember) ?? null;
}

export function isManagementRole(role: CrewRole): boolean {
  return MANAGEMENT_ROLES.includes(role);
}
