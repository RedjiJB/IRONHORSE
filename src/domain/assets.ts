// Re-expressed from v1's assets domain logic -- requirements baseline,
// not copied code. Golden rule: an asset is never usable (never
// assignable to a loadout, never checked out) until it has been
// physically verified at least once. New assets always start
// 'unconfirmed'; 'available' is reachable *only* through the two-party
// confirm-before-execute asset_verification flow below -- a crew member's
// own "I checked it, it's fine" claim isn't independent verification of
// anything, same reasoning already applied to timeclock events.
import { pool } from "../db/pool.js";
import { registerConfirmationExecutor } from "./confirmations.js";

export type AssetStatus = "unconfirmed" | "available" | "checked_out" | "missing" | "in_maintenance" | "retired";

// setAssetStatus is the only direct (non-confirmation) status route, and
// it explicitly excludes 'available' -- matching v1's route, which never
// allowed setting available any other way than physical verification.
// 'checked_out' is also excluded here since it's only ever entered/exited
// through the checkout lifecycle (src/domain/checkouts.ts), not this
// generic route.
const DIRECTLY_SETTABLE_STATUSES: AssetStatus[] = ["missing", "in_maintenance", "retired"];

export type Asset = {
  id: string;
  name: string;
  category: string | null;
  qr_tag_id: string | null;
  purchase_date: string | null;
  condition: string | null;
  current_site_id: string | null;
  current_holder: string | null;
  status: AssetStatus;
  last_verified_at: string | null;
  verified_by: string | null;
  service_interval_days: number | null;
  last_serviced_at: string | null;
  created_at: string;
};

export async function registerAsset(args: {
  name: string;
  category?: string;
  qrTagId?: string;
  purchaseDate?: string;
  condition?: string;
  currentSiteId?: string;
  serviceIntervalDays?: number;
}): Promise<Asset> {
  const result = await pool.query(
    `INSERT INTO assets (name, category, qr_tag_id, purchase_date, condition, current_site_id, service_interval_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      args.name,
      args.category ?? null,
      args.qrTagId ?? null,
      args.purchaseDate ?? null,
      args.condition ?? null,
      args.currentSiteId ?? null,
      args.serviceIntervalDays ?? null,
    ],
  );
  return result.rows[0] as Asset;
}

export type SetAssetStatusResult =
  | { ok: true; asset: Asset }
  | { ok: false; reason: "not_found" | "status_not_directly_settable" };

export async function setAssetStatus(id: string, status: AssetStatus): Promise<SetAssetStatusResult> {
  if (!DIRECTLY_SETTABLE_STATUSES.includes(status)) {
    return { ok: false, reason: "status_not_directly_settable" };
  }
  const result = await pool.query(
    `UPDATE assets SET status = $2 WHERE id = $1 RETURNING *`,
    [id, status],
  );
  if (!result.rows[0]) return { ok: false, reason: "not_found" };
  return { ok: true, asset: result.rows[0] as Asset };
}

export async function listAssets(filter?: { status?: AssetStatus; category?: string }): Promise<Asset[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.status) {
    params.push(filter.status);
    conditions.push(`status = $${params.length}`);
  }
  if (filter?.category) {
    params.push(filter.category);
    conditions.push(`category = $${params.length}`);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await pool.query(`SELECT * FROM assets ${where} ORDER BY name`, params);
  return result.rows as Asset[];
}

export async function getAsset(id: string): Promise<Asset | null> {
  const result = await pool.query("SELECT * FROM assets WHERE id = $1", [id]);
  return (result.rows[0] as Asset) ?? null;
}

// Calendar-interval only, same deliberate scope as v1 -- no usage/hours
// tracking exists. NULL service_interval_days means "no schedule
// configured," not "due now." Computed on read, never stored.
export function resolveNextServiceDue(asset: Asset): Date | null {
  if (asset.service_interval_days == null) return null;
  const base = asset.last_serviced_at ?? asset.created_at;
  const due = new Date(base);
  due.setDate(due.getDate() + asset.service_interval_days);
  return due;
}

// Resets the maintenance clock. Does NOT auto-resolve any open
// maintenance alert -- same as v1, alert resolution is always a
// deliberate human action, never implicit (the alerts engine itself is
// separate, deferred scope, but this domain function's contract needs to
// already hold true for it).
export async function logAssetService(id: string): Promise<Asset | null> {
  const result = await pool.query(
    "UPDATE assets SET last_serviced_at = now() WHERE id = $1 RETURNING *",
    [id],
  );
  return (result.rows[0] as Asset) ?? null;
}

// Registered once at server startup (see src/mcp/tools/assets.ts). The
// payload's crewMemberId is whoever physically checked the asset and
// submitted the confirmation -- recorded as verified_by. The approving
// reviewer's identity is only used for the authorization gate in
// approveConfirmation, never recorded as the verifier, same convention
// timeclock events already established.
export function registerAssetVerificationExecutor(): void {
  registerConfirmationExecutor("asset_verification", async (payload) => {
    const assetId = payload.assetId as string;
    const crewMemberId = payload.crewMemberId as string;
    const result = await pool.query(
      `UPDATE assets SET status = 'available', last_verified_at = now(), verified_by = $2
       WHERE id = $1 RETURNING id`,
      [assetId, crewMemberId],
    );
    return { resultId: result.rows[0].id as string };
  });
}
