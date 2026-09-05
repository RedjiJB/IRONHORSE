// Patrol routes and runs (DOMAIN-DESIGN.md §1, resolved 2026-09-04). No
// dcentral-fieldops equivalent to adapt from -- landscaping has no patrol
// concept.
import { pool } from "../db/pool.js";
import { getShift } from "./shifts.js";

export type PatrolRoute = {
  id: string;
  site_id: string;
  name: string;
  active: boolean;
  created_at: string;
};

export async function createPatrolRoute(args: { siteId: string; name: string }): Promise<PatrolRoute> {
  const result = await pool.query(
    `INSERT INTO patrol_routes (site_id, name) VALUES ($1, $2) RETURNING *`,
    [args.siteId, args.name],
  );
  return result.rows[0] as PatrolRoute;
}

export async function listPatrolRoutes(filter?: { siteId?: string }): Promise<PatrolRoute[]> {
  if (filter?.siteId) {
    const result = await pool.query("SELECT * FROM patrol_routes WHERE site_id = $1 ORDER BY name", [filter.siteId]);
    return result.rows as PatrolRoute[];
  }
  const result = await pool.query("SELECT * FROM patrol_routes ORDER BY name");
  return result.rows as PatrolRoute[];
}

export async function getPatrolRoute(id: string): Promise<PatrolRoute | null> {
  const result = await pool.query("SELECT * FROM patrol_routes WHERE id = $1", [id]);
  return (result.rows[0] as PatrolRoute) ?? null;
}

export type PatrolRunStatus = "in_progress" | "completed" | "abandoned";

export type PatrolRun = {
  id: string;
  patrol_route_id: string;
  guard_id: string;
  shift_id: string;
  started_at: string;
  completed_at: string | null;
  status: PatrolRunStatus;
};

export type StartPatrolRunResult =
  | { ok: true; run: PatrolRun }
  | { ok: false; reason: "route_not_found" | "shift_not_found" | "shift_not_owned_by_guard" | "shift_site_mismatch" };

// Enforces the resolved decision at the domain layer, not just the FK:
// the shift must actually belong to this guard and be at the same site as
// the route -- a shift_id that merely exists isn't enough, it has to be
// *this guard's own* assignment at *this* site. A bare FK constraint alone
// would let a guard start a patrol against someone else's shift or a
// shift at a different site.
export async function startPatrolRun(args: { patrolRouteId: string; guardId: string; shiftId: string }): Promise<StartPatrolRunResult> {
  const route = await getPatrolRoute(args.patrolRouteId);
  if (!route) return { ok: false, reason: "route_not_found" };

  const shift = await getShift(args.shiftId);
  if (!shift) return { ok: false, reason: "shift_not_found" };
  if (shift.guard_id !== args.guardId) return { ok: false, reason: "shift_not_owned_by_guard" };
  if (shift.site_id !== route.site_id) return { ok: false, reason: "shift_site_mismatch" };

  const result = await pool.query(
    `INSERT INTO patrol_runs (patrol_route_id, guard_id, shift_id) VALUES ($1, $2, $3) RETURNING *`,
    [args.patrolRouteId, args.guardId, args.shiftId],
  );
  return { ok: true, run: result.rows[0] as PatrolRun };
}

export async function completePatrolRun(id: string): Promise<PatrolRun | null> {
  const result = await pool.query(
    `UPDATE patrol_runs SET status = 'completed', completed_at = now() WHERE id = $1 AND status = 'in_progress' RETURNING *`,
    [id],
  );
  return (result.rows[0] as PatrolRun) ?? null;
}

export async function abandonPatrolRun(id: string): Promise<PatrolRun | null> {
  const result = await pool.query(
    `UPDATE patrol_runs SET status = 'abandoned', completed_at = now() WHERE id = $1 AND status = 'in_progress' RETURNING *`,
    [id],
  );
  return (result.rows[0] as PatrolRun) ?? null;
}

export async function listPatrolRuns(filter?: { guardId?: string; status?: PatrolRunStatus }): Promise<PatrolRun[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.guardId) {
    params.push(filter.guardId);
    conditions.push(`guard_id = $${params.length}`);
  }
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM patrol_runs ${where} ORDER BY started_at DESC`, params);
  return result.rows as PatrolRun[];
}

export async function getPatrolRun(id: string): Promise<PatrolRun | null> {
  const result = await pool.query("SELECT * FROM patrol_runs WHERE id = $1", [id]);
  return (result.rows[0] as PatrolRun) ?? null;
}
