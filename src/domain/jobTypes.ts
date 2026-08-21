import { pool } from "../db/pool.js";

export type JobType = { id: string; name: string };

export async function listJobTypes(): Promise<JobType[]> {
  const result = await pool.query("SELECT * FROM job_types ORDER BY name");
  return result.rows as JobType[];
}
