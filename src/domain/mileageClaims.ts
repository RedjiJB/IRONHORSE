// Re-expressed from v1's mileage-claim domain logic -- requirements
// baseline, not copied code. distance_km is purely driver-self-reported
// -- independent of trips.distance_meters (the haversine-summed GPS
// estimate from vehicle_telemetry); no code ties a mileage claim to a
// specific trip, same as v1. rate_per_km is supplied by the approver AT
// APPROVAL TIME, not the driver at submission -- confirmed no
// system-wide mileage-rate setting exists anywhere in v1, letting
// different claims get different agreed rates.
//
// Deviation from v1: v1 credits the *approving reviewer* as
// reviewed_by/reviewed_by_user_id on the resulting spend_records row.
// Same reasoning as purchase_order_fulfillment (src/domain/
// purchaseOrders.ts): this system's confirmation executor never receives
// the approving reviewer's identity, only the original payload -- so
// crew_member_id/submitted_by here are the driver who submitted the
// claim; "who approved it" lives on pending_confirmations.reviewed_by,
// not duplicated onto this row.
import { pool } from "../db/pool.js";
import { registerConfirmationExecutor } from "./confirmations.js";

export function registerMileageClaimExecutor(): void {
  registerConfirmationExecutor("mileage_claim", async (payload, approvalData) => {
    const crewMemberId = payload.crewMemberId as string;
    const distanceKm = payload.distanceKm as number;
    const description = (payload.description as string | null | undefined) ?? null;
    const ratePerKm = approvalData?.ratePerKm as number | undefined;
    if (ratePerKm == null) throw new Error("mileage_claim failed: rate_per_km is required at approval");

    const amount = distanceKm * ratePerKm;
    const result = await pool.query(
      `INSERT INTO spend_records (category, method, status, amount, distance_km, rate_per_km, description, crew_member_id, submitted_by)
       VALUES ('mileage', 'personal_reimbursed', 'approved', $1, $2, $3, $4, $5, $5) RETURNING id`,
      [amount, distanceKm, ratePerKm, description, crewMemberId],
    );
    return { resultId: result.rows[0].id as string };
  });
}
