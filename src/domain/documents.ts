// Re-expressed from v1's documents domain logic -- requirements
// baseline, not copied code. Local filesystem storage (UPLOAD_DIR), not
// S3 or base64-in-DB. storage_path is always a randomly generated
// filename, never derived from the caller-supplied original filename --
// the one deliberate security property carried forward from v1 (prevents
// path traversal from a malicious filename).
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "../db/pool.js";

// Matches v1's upload-time allowlist -- only these render inline; the
// actual enforcement of "only these MIME types may be uploaded" happens
// in uploadDocument below, not just documented here.
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "application/pdf"];

function uploadDir(): string {
  return process.env.UPLOAD_DIR ?? "./uploads";
}

export type Document = {
  id: string;
  job_id: string | null;
  site_id: string | null;
  type: string;
  filename: string;
  storage_path: string | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  tags: string[] | null;
  expiry_date: string | null;
};

// Metadata-only row -- no file. storage_path/mime_type stay NULL.
export async function registerDocument(args: {
  type: string;
  filename: string;
  jobId?: string;
  siteId?: string;
  uploadedBy?: string;
  tags?: string[];
  expiryDate?: string;
}): Promise<Document> {
  const result = await pool.query(
    `INSERT INTO documents (job_id, site_id, type, filename, uploaded_by, tags, expiry_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [args.jobId ?? null, args.siteId ?? null, args.type, args.filename, args.uploadedBy ?? null, args.tags ?? null, args.expiryDate ?? null],
  );
  return result.rows[0] as Document;
}

export type UploadDocumentResult = { ok: true; document: Document } | { ok: false; reason: "invalid_base64" | "mime_type_not_allowed" };

// Real file upload: decodes base64, writes to UPLOAD_DIR under a random
// generated filename, then inserts the row. Validates the MIME type
// against the allowlist before writing anything to disk.
export async function uploadDocument(args: {
  type: string;
  filename: string;
  mimeType: string;
  contentBase64: string;
  jobId?: string;
  siteId?: string;
  uploadedBy?: string;
  tags?: string[];
  expiryDate?: string;
}): Promise<UploadDocumentResult> {
  if (!ALLOWED_MIME_TYPES.includes(args.mimeType)) {
    return { ok: false, reason: "mime_type_not_allowed" };
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(args.contentBase64, "base64");
    if (buffer.length === 0) throw new Error("empty");
  } catch {
    return { ok: false, reason: "invalid_base64" };
  }

  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const storagePath = randomUUID();
  await writeFile(path.join(dir, storagePath), buffer);

  const result = await pool.query(
    `INSERT INTO documents (job_id, site_id, type, filename, storage_path, mime_type, uploaded_by, tags, expiry_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [args.jobId ?? null, args.siteId ?? null, args.type, args.filename, storagePath, args.mimeType, args.uploadedBy ?? null, args.tags ?? null, args.expiryDate ?? null],
  );
  return { ok: true, document: result.rows[0] as Document };
}

export async function readDocumentFile(id: string): Promise<{ buffer: Buffer; mimeType: string | null } | null> {
  const doc = await pool.query("SELECT storage_path, mime_type FROM documents WHERE id = $1", [id]);
  const row = doc.rows[0];
  if (!row || !row.storage_path) return null;
  const buffer = await readFile(path.join(uploadDir(), row.storage_path));
  return { buffer, mimeType: row.mime_type };
}

// The only mutation route besides creation -- lets a photo auto-filed as
// 'photo' get corrected to its real type once classified, same as v1.
export async function classifyDocument(id: string, type: string): Promise<Document | null> {
  const result = await pool.query("UPDATE documents SET type = $2 WHERE id = $1 RETURNING *", [id, type]);
  return (result.rows[0] as Document) ?? null;
}

export async function listDocuments(filter?: { siteId?: string; type?: string }): Promise<Document[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.siteId) {
    params.push(filter.siteId);
    conditions.push(`site_id = $${params.length}`);
  }
  if (filter?.type) {
    params.push(filter.type);
    conditions.push(`type = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM documents ${where} ORDER BY uploaded_at DESC`, params);
  return result.rows as Document[];
}

// Includes already-past-expiry rows, not just upcoming -- an expired
// insurance cert is more urgent than one expiring next week, same as v1.
export async function listExpiringDocuments(withinDays: number): Promise<Document[]> {
  const result = await pool.query(
    `SELECT * FROM documents WHERE expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + ($1 || ' days')::interval ORDER BY expiry_date`,
    [withinDays],
  );
  return result.rows as Document[];
}
