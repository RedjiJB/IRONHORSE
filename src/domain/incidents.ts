// Incident reporting (FEATURES.md §4, DOMAIN-DESIGN.md §2). Not adapted
// from dcentral-fieldops's fieldReports.ts (a daily narrative summary with
// workforce/equipment derived live, a genuinely different concept) --
// this follows DOMAIN-DESIGN.md §2's own resolved sketch: severity,
// status, and an append-only action log, not a mutable "current state"
// row.
//
// Note: incident_media (photos/camera snapshots attached to an incident,
// per FEATURES.md §2/§4) is intentionally NOT built here -- it depends on
// a documents.ts storage layer that doesn't exist in this pruned tree yet
// (see PRECEDENT-ARCHITECTURE.md §6's documents.ts). Attaching media is
// real follow-up work, not silently dropped -- see ROADMAP.md.
import { pool } from "../db/pool.js";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "escalated" | "resolved";

export type Incident = {
  id: string;
  site_id: string;
  reported_by_guard_id: string;
  category: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  summary: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
  resolved_at: string | null;
};

export async function reportIncident(args: {
  siteId: string;
  reportedByGuardId: string;
  category: string;
  severity: IncidentSeverity;
  summary: string;
  lat?: number | null;
  lng?: number | null;
}): Promise<Incident> {
  const result = await pool.query(
    `INSERT INTO incidents (site_id, reported_by_guard_id, category, severity, summary, lat, lng)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [args.siteId, args.reportedByGuardId, args.category, args.severity, args.summary, args.lat ?? null, args.lng ?? null],
  );
  return result.rows[0] as Incident;
}

export async function listIncidents(filter?: { siteId?: string; status?: IncidentStatus }): Promise<Incident[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.siteId) {
    params.push(filter.siteId);
    conditions.push(`site_id = $${params.length}`);
  }
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM incidents ${where} ORDER BY created_at DESC`, params);
  return result.rows as Incident[];
}

export async function getIncident(id: string): Promise<Incident | null> {
  const result = await pool.query("SELECT * FROM incidents WHERE id = $1", [id]);
  return (result.rows[0] as Incident) ?? null;
}

export type IncidentAction = {
  id: string;
  incident_id: string;
  actor_guard_id: string;
  action_type: "escalated" | "reassigned" | "note_added" | "resolved";
  note: string | null;
  new_severity: IncidentSeverity | null;
  created_at: string;
};

// A severity bump (per FEATURES.md §3: supervisor bumping severity before
// it reaches the client) is a row here, never a direct UPDATE to
// incidents.severity -- see getCurrentSeverity for how "what's the
// severity right now" gets answered without that mutation.
export async function addIncidentAction(args: {
  incidentId: string;
  actorGuardId: string;
  actionType: "escalated" | "reassigned" | "note_added" | "resolved";
  note?: string;
  newSeverity?: IncidentSeverity;
}): Promise<IncidentAction> {
  const result = await pool.query(
    `INSERT INTO incident_actions (incident_id, actor_guard_id, action_type, note, new_severity)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [args.incidentId, args.actorGuardId, args.actionType, args.note ?? null, args.newSeverity ?? null],
  );

  // status is not append-only the way severity is -- DOMAIN-DESIGN.md
  // only calls out severity as needing the hash-chain-preserving
  // treatment. 'escalated'/'resolved' actions do update incidents.status
  // directly, same as shifts.confirmShift updating shifts.status.
  if (args.actionType === "resolved") {
    await pool.query("UPDATE incidents SET status = 'resolved', resolved_at = now() WHERE id = $1", [args.incidentId]);
  } else if (args.actionType === "escalated") {
    await pool.query("UPDATE incidents SET status = 'escalated' WHERE id = $1", [args.incidentId]);
  }

  return result.rows[0] as IncidentAction;
}

export async function listIncidentActions(incidentId: string): Promise<IncidentAction[]> {
  const result = await pool.query(
    "SELECT * FROM incident_actions WHERE incident_id = $1 ORDER BY created_at",
    [incidentId],
  );
  return result.rows as IncidentAction[];
}

// The incident's current severity is the latest escalation's new_severity
// if one exists, else the severity it was reported at -- never a stored,
// mutated field. Same reasoning DOMAIN-DESIGN.md §2 gives for keeping
// incidents.severity untouched.
export async function getCurrentSeverity(incidentId: string): Promise<IncidentSeverity | null> {
  const latest = await pool.query(
    `SELECT new_severity FROM incident_actions
     WHERE incident_id = $1 AND new_severity IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [incidentId],
  );
  if (latest.rows[0]) return latest.rows[0].new_severity as IncidentSeverity;

  const incident = await getIncident(incidentId);
  return incident?.severity ?? null;
}
