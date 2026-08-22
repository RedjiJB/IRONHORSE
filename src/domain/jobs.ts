// Re-expressed from v1's jobs domain logic -- requirements baseline, not
// copied code. A job is a genuine entity, not just a column on shifts --
// one site+date+job_type dispatch can span multiple crew members' shifts
// (multi-team dispatch). Only created when a dispatch actually identifies
// a job type; a shift without one behaves exactly as before this existed
// (job_id nullable on shifts).
//
// This was a real gap from Phase 2 slice 1: the `jobs` table
// (0008_job_types_and_jobs.sql) and shifts.job_id existed, but nothing
// ever created a jobs row or linked a shift to one -- which meant the
// loadout_gap alert (see src/domain/exceptions.ts) could never actually
// fire in practice, since its query requires a real jobs row with a
// linked, confirmed shift. Closing that gap here, not scope creep for
// this slice.
import { pool } from "../db/pool.js";

export type JobStatus = "not_started" | "in_progress" | "complete";

export type Job = {
  id: string;
  site_id: string;
  job_type_id: string | null;
  date: string;
  status: JobStatus;
  started_at: string | null;
  started_by: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
};

export async function createJob(args: { siteId: string; jobTypeId?: string; date: string }): Promise<Job> {
  const result = await pool.query(
    `INSERT INTO jobs (site_id, job_type_id, date) VALUES ($1, $2, $3) RETURNING *`,
    [args.siteId, args.jobTypeId ?? null, args.date],
  );
  return result.rows[0] as Job;
}

export async function getJob(id: string): Promise<Job | null> {
  const result = await pool.query("SELECT * FROM jobs WHERE id = $1", [id]);
  return (result.rows[0] as Job) ?? null;
}

export async function listJobs(filter?: { siteId?: string; date?: string; status?: JobStatus }): Promise<Job[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.siteId) {
    params.push(filter.siteId);
    conditions.push(`site_id = $${params.length}`);
  }
  if (filter?.date) {
    params.push(filter.date);
    conditions.push(`date = $${params.length}`);
  }
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM jobs ${where} ORDER BY date DESC`, params);
  return result.rows as Job[];
}

export async function startJob(id: string, crewMemberId: string): Promise<Job | null> {
  const result = await pool.query(
    `UPDATE jobs SET status = 'in_progress', started_at = now(), started_by = $2 WHERE id = $1 RETURNING *`,
    [id, crewMemberId],
  );
  return (result.rows[0] as Job) ?? null;
}

export async function completeJob(id: string, crewMemberId: string): Promise<Job | null> {
  const result = await pool.query(
    `UPDATE jobs SET status = 'complete', completed_at = now(), completed_by = $2 WHERE id = $1 RETURNING *`,
    [id, crewMemberId],
  );
  return (result.rows[0] as Job) ?? null;
}
