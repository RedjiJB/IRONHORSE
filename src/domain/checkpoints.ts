// Checkpoints and checkpoint scans (DOMAIN-DESIGN.md §1). GPS-method
// checkpoints reuse the same haversine-distance verification pattern
// timeclock.ts's resolveGeofenceVerified uses for shift check-in -- not
// that exact function, since it checks a *site's* stored geofence, and a
// checkpoint has its own independent lat/lng/radius_m, a different
// verification target entirely. QR/NFC methods verify by exact token
// match instead of distance.
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "./geo.js";

export type CheckpointVerificationMethod = "qr" | "nfc" | "gps";

export type Checkpoint = {
  id: string;
  patrol_route_id: string;
  sequence: number;
  label: string;
  verification_method: CheckpointVerificationMethod;
  qr_or_nfc_token: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  created_at: string;
};

export async function createCheckpoint(args: {
  patrolRouteId: string;
  sequence: number;
  label: string;
  verificationMethod: CheckpointVerificationMethod;
  qrOrNfcToken?: string;
  lat?: number;
  lng?: number;
  radiusM?: number;
}): Promise<Checkpoint> {
  const result = await pool.query(
    `INSERT INTO checkpoints (patrol_route_id, sequence, label, verification_method, qr_or_nfc_token, lat, lng, radius_m)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      args.patrolRouteId,
      args.sequence,
      args.label,
      args.verificationMethod,
      args.qrOrNfcToken ?? null,
      args.lat ?? null,
      args.lng ?? null,
      args.radiusM ?? null,
    ],
  );
  return result.rows[0] as Checkpoint;
}

export async function listCheckpoints(patrolRouteId: string): Promise<Checkpoint[]> {
  const result = await pool.query(
    "SELECT * FROM checkpoints WHERE patrol_route_id = $1 ORDER BY sequence",
    [patrolRouteId],
  );
  return result.rows as Checkpoint[];
}

export async function getCheckpoint(id: string): Promise<Checkpoint | null> {
  const result = await pool.query("SELECT * FROM checkpoints WHERE id = $1", [id]);
  return (result.rows[0] as Checkpoint) ?? null;
}

// No lat/lng, no checkpoint radius configured, no matching token -- all
// fall through to false, same "no path to assert true without real
// verification data" discipline resolveGeofenceVerified already uses.
function resolveCheckpointVerified(
  checkpoint: Checkpoint,
  args: { submittedToken?: string | null; lat?: number | null; lng?: number | null },
): boolean {
  if (checkpoint.verification_method === "gps") {
    if (args.lat == null || args.lng == null || checkpoint.lat == null || checkpoint.lng == null || checkpoint.radius_m == null) {
      return false;
    }
    return haversineDistanceMeters(args.lat, args.lng, checkpoint.lat, checkpoint.lng) <= checkpoint.radius_m;
  }
  // qr / nfc
  if (!checkpoint.qr_or_nfc_token || !args.submittedToken) return false;
  return args.submittedToken === checkpoint.qr_or_nfc_token;
}

export type CheckpointScan = {
  id: string;
  patrol_run_id: string;
  checkpoint_id: string;
  scanned_at: string;
  verified: boolean;
  exception_note: string | null;
};

export type ScanCheckpointResult = { ok: true; scan: CheckpointScan } | { ok: false; reason: "checkpoint_not_found" };

export async function scanCheckpoint(args: {
  patrolRunId: string;
  checkpointId: string;
  submittedToken?: string;
  lat?: number;
  lng?: number;
  exceptionNote?: string;
}): Promise<ScanCheckpointResult> {
  const checkpoint = await getCheckpoint(args.checkpointId);
  if (!checkpoint) return { ok: false, reason: "checkpoint_not_found" };

  const verified = resolveCheckpointVerified(checkpoint, args);
  const result = await pool.query(
    `INSERT INTO checkpoint_scans (patrol_run_id, checkpoint_id, verified, exception_note)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [args.patrolRunId, args.checkpointId, verified, args.exceptionNote ?? null],
  );
  return { ok: true, scan: result.rows[0] as CheckpointScan };
}

export async function listCheckpointScans(patrolRunId: string): Promise<CheckpointScan[]> {
  const result = await pool.query(
    "SELECT * FROM checkpoint_scans WHERE patrol_run_id = $1 ORDER BY scanned_at",
    [patrolRunId],
  );
  return result.rows as CheckpointScan[];
}
