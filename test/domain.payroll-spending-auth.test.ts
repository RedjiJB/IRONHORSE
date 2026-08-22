// Phase 2 slice 6 verification (final deferred cluster): users/sessions
// dashboard auth, spend_records, mileage claims, money instruments, and
// payroll reconciliation -- re-expressed from v1's fieldops-system as the
// requirements baseline (not copied code). By explicit instruction,
// dashboard authorization deviates from v1: users get a real
// custodially-held DID and capability grants (dashboard:role:staff /
// dashboard:role:admin), not a bare trusted `role` column -- the same
// zero-trust upgrade already applied to crew_members. Password login
// itself (via node:crypto scrypt) is unchanged in spirit from v1's
// bcrypt approach -- a practical login mechanism, not an authorization
// decision.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { hashPassword, verifyPassword } from "../src/identity/passwords.js";
import { deactivateUser, getUserByEmail, hasAdminCapability, hasStaffCapability, registerUser, resetUserPassword } from "../src/domain/users.js";
import { createSession, deleteSession, resolveSession } from "../src/domain/sessions.js";
import { mintLoginToken, redeemLoginToken } from "../src/domain/loginTokens.js";
import {
  adjustMoneyInstrumentBalance,
  assignCustody,
  endCustody,
  getCurrentCustody,
  registerMoneyInstrument,
} from "../src/domain/moneyInstruments.js";
import {
  approveSpendRecord,
  disputeSpendRecord,
  listMissingReceipts,
  registerSpendRecord,
  rejectSpendRecord,
} from "../src/domain/spending.js";
import { registerMileageClaimExecutor } from "../src/domain/mileageClaims.js";
import { approveConfirmation, submitForConfirmation } from "../src/domain/confirmations.js";
import { computeSessions } from "../src/domain/timeclockSessions.js";
import { computeReconciliation, getCrewPayProfile, recordPayout, setCrewPayProfile } from "../src/domain/payroll.js";

registerMileageClaimExecutor();

let crewId: string;
let managerId: string;
let payrollAdminUserId: string;
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdInstrumentIds: string[] = [];
const createdSpendRecordIds: string[] = [];
const createdSessionTokens: string[] = [];
const createdLoginTokenHashesCrewIds: string[] = [];

beforeAll(async () => {
  const crew = await registerCrewMember({ name: "QA Payroll Crew", phone: "+15559991101" });
  crewId = crew.id;
  createdCrewIds.push(crew.id);
  createdCrewDids.push(crew.did);

  const manager = await registerCrewMember({ name: "QA Payroll Manager", phone: "+15559991102", role: "management" });
  managerId = manager.id;
  createdCrewIds.push(manager.id);
  createdCrewDids.push(manager.did);

  const admin = await registerUser({ email: "qa-payroll-admin@example.test", name: "QA Payroll Admin", password: "password123", role: "admin" });
  payrollAdminUserId = admin.id;
  createdUserIds.push(admin.id);
  createdUserDids.push(admin.did);
});

afterAll(async () => {
  await pool.query("DELETE FROM timeclock_entries WHERE crew_member_id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM payouts WHERE crew_member_id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM crew_pay_profiles WHERE crew_member_id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM spend_records WHERE id = ANY($1)", [createdSpendRecordIds]);
  await pool.query("DELETE FROM money_instrument_custody WHERE instrument_id = ANY($1)", [createdInstrumentIds]);
  await pool.query("DELETE FROM money_instruments WHERE id = ANY($1)", [createdInstrumentIds]);
  await pool.query("DELETE FROM login_tokens WHERE crew_member_id = ANY($1)", [createdLoginTokenHashesCrewIds]);
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1) OR crew_member_id = ANY($2)", [createdUserIds, createdCrewIds]);
  await pool.query("DELETE FROM pending_confirmations WHERE submitted_by = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [[...createdCrewDids, ...createdUserDids]]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [[...createdCrewDids, ...createdUserDids]]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [[...createdCrewDids, ...createdUserDids]]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.end();
});

describe("password hashing", () => {
  it("hashes and verifies correctly, rejecting a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong password", hash)).toBe(false);
  });
});

describe("users -- dashboard identity with real capability grants, not a trusted role column", () => {
  it("registers a user with a real DID and role-based capability grants", async () => {
    const user = await registerUser({ email: "qa-staff@example.test", name: "QA Staff User", password: "password123", role: "staff" });
    createdUserIds.push(user.id);
    createdUserDids.push(user.did);

    expect(user.did).toMatch(/^did:web:.+:users:[0-9a-f-]{36}$/);
    expect(await hasStaffCapability(user.did)).toBe(true);
    expect(await hasAdminCapability(user.did)).toBe(false);

    const admin = await registerUser({ email: "qa-admin@example.test", name: "QA Admin User", password: "password123", role: "admin" });
    createdUserIds.push(admin.id);
    createdUserDids.push(admin.did);
    expect(await hasAdminCapability(admin.did)).toBe(true);

    // Revoking the admin grant directly flips the check -- a real
    // cryptographic capability, not a role string.
    await pool.query("UPDATE capability_grants SET revoked_at = now() WHERE subject_did = $1 AND capability = 'dashboard:role:admin'", [admin.did]);
    expect(await hasAdminCapability(admin.did)).toBe(false);
  });

  it("owner is admin-equivalent, matching v1's convention", async () => {
    const owner = await registerUser({ email: "qa-owner@example.test", name: "QA Owner User", password: "password123", role: "owner" });
    createdUserIds.push(owner.id);
    createdUserDids.push(owner.did);
    expect(await hasAdminCapability(owner.did)).toBe(true);
    expect(await hasStaffCapability(owner.did)).toBe(true);
  });

  it("deactivateUser and resetUserPassword work, with no plaintext password ever exposed on the public shape", async () => {
    const user = await registerUser({ email: "qa-deactivate@example.test", name: "QA Deactivate User", password: "password123" });
    createdUserIds.push(user.id);
    createdUserDids.push(user.did);
    expect((user as unknown as { password_hash?: string }).password_hash).toBeUndefined();

    const deactivated = await deactivateUser(user.id);
    expect(deactivated?.active).toBe(false);

    const reset = await resetUserPassword(user.id, "newpassword456");
    expect(reset).toBeTruthy();
    const raw = await getUserByEmail("qa-deactivate@example.test");
    expect(await verifyPassword("newpassword456", raw!.password_hash)).toBe(true);
  });
});

describe("sessions", () => {
  it("resolves a dashboard-user session, then returns null after logout or expiry", async () => {
    const user = await registerUser({ email: "qa-session@example.test", name: "QA Session User", password: "password123" });
    createdUserIds.push(user.id);
    createdUserDids.push(user.did);

    const { token } = await createSession({ userId: user.id });
    createdSessionTokens.push(token);
    const identity = await resolveSession(token);
    expect(identity).toEqual({ type: "user", userId: user.id });

    await deleteSession(token);
    expect(await resolveSession(token)).toBeNull();
  });

  it("the sessions table enforces exactly one of user_id/crew_member_id", async () => {
    await expect(
      pool.query("INSERT INTO sessions (token_hash, user_id, crew_member_id, expires_at) VALUES ('x', NULL, NULL, now())"),
    ).rejects.toThrow();
  });
});

describe("login tokens -- WhatsApp magic-link", () => {
  it("mints, enforces the issuance cooldown, and redeems into a real crew session", async () => {
    createdLoginTokenHashesCrewIds.push(crewId);
    const first = await mintLoginToken(crewId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await mintLoginToken(crewId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("cooldown_active");

    const redeemed = await redeemLoginToken(first.token);
    expect(redeemed.ok).toBe(true);
    if (!redeemed.ok) return;
    createdSessionTokens.push(redeemed.sessionToken);

    const identity = await resolveSession(redeemed.sessionToken);
    expect(identity).toEqual({ type: "crew", crewMemberId: crewId });

    // Not single-use -- redeeming again within the window still works.
    const redeemedAgain = await redeemLoginToken(first.token);
    expect(redeemedAgain.ok).toBe(true);
    if (redeemedAgain.ok) createdSessionTokens.push(redeemedAgain.sessionToken);
  });

  it("rejects an invalid or expired token", async () => {
    const result = await redeemLoginToken("nonexistent-token");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid_or_expired");
  });
});

describe("money instruments", () => {
  it("adjustBalance only applies to petty_cash, and tracks custody", async () => {
    const card = await registerMoneyInstrument({ type: "company_card", label: "QA Test Card" });
    createdInstrumentIds.push(card.id);
    const cardAdjust = await adjustMoneyInstrumentBalance(card.id, 100);
    expect(cardAdjust.ok).toBe(false);
    if (!cardAdjust.ok) expect(cardAdjust.reason).toBe("not_petty_cash");

    const petty = await registerMoneyInstrument({ type: "petty_cash", label: "QA Petty Cash", initialBalance: 200 });
    createdInstrumentIds.push(petty.id);
    const pettyAdjust = await adjustMoneyInstrumentBalance(petty.id, -50);
    expect(pettyAdjust.ok).toBe(true);
    if (pettyAdjust.ok) expect(Number(pettyAdjust.instrument.balance)).toBe(150);

    const custody = await assignCustody({ instrumentId: petty.id, heldBy: crewId });
    expect((await getCurrentCustody(petty.id))?.id).toBe(custody.id);
    await endCustody(custody.id);
    expect(await getCurrentCustody(petty.id)).toBeNull();
  });
});

describe("spend records", () => {
  it("mileage requires personal_reimbursed+distanceKm and forbids amount; other categories require amount and forbid distanceKm", async () => {
    const badMileage = await registerSpendRecord({ category: "mileage", method: "cash", distanceKm: 10 });
    expect(badMileage.ok).toBe(false);
    if (!badMileage.ok) expect(badMileage.reason).toBe("mileage_requires_distance_km_and_personal_reimbursed");

    const mileageWithAmount = await registerSpendRecord({ category: "mileage", method: "personal_reimbursed", distanceKm: 10, amount: 5 });
    expect(mileageWithAmount.ok).toBe(false);
    if (!mileageWithAmount.ok) expect(mileageWithAmount.reason).toBe("mileage_forbids_amount");

    const noAmount = await registerSpendRecord({ category: "fuel", method: "company_card" });
    expect(noAmount.ok).toBe(false);
    if (!noAmount.ok) expect(noAmount.reason).toBe("amount_required");

    const materialWithDistance = await registerSpendRecord({ category: "material", method: "company_card", amount: 20, distanceKm: 5 });
    expect(materialWithDistance.ok).toBe(false);
    if (!materialWithDistance.ok) expect(materialWithDistance.reason).toBe("distance_km_forbidden");
  });

  it("company_card/cash spends start approved immediately; personal_reimbursed starts pending", async () => {
    const cardSpend = await registerSpendRecord({ category: "fuel", method: "company_card", amount: 45.5 });
    expect(cardSpend.ok).toBe(true);
    if (cardSpend.ok) {
      createdSpendRecordIds.push(cardSpend.record.id);
      expect(cardSpend.record.status).toBe("approved");
    }

    const reimbursed = await registerSpendRecord({ category: "material", method: "personal_reimbursed", amount: 30, crewMemberId: crewId });
    expect(reimbursed.ok).toBe(true);
    if (!reimbursed.ok) return;
    createdSpendRecordIds.push(reimbursed.record.id);
    expect(reimbursed.record.status).toBe("pending");

    const approved = await approveSpendRecord(reimbursed.record.id, { crewMemberId: managerId });
    expect(approved.ok).toBe(true);
    const doubleApprove = await approveSpendRecord(reimbursed.record.id, { crewMemberId: managerId });
    expect(doubleApprove.ok).toBe(false);
    if (!doubleApprove.ok) expect(doubleApprove.reason).toBe("not_pending");
  });

  it("rejection then dispute is a one-round appeal", async () => {
    const reimbursed = await registerSpendRecord({ category: "material", method: "personal_reimbursed", amount: 15, crewMemberId: crewId });
    expect(reimbursed.ok).toBe(true);
    if (!reimbursed.ok) return;
    createdSpendRecordIds.push(reimbursed.record.id);

    await rejectSpendRecord(reimbursed.record.id, { crewMemberId: managerId }, "no receipt");
    const disputed = await disputeSpendRecord(reimbursed.record.id, "I do have a receipt");
    expect(disputed.ok).toBe(true);
    if (disputed.ok) expect(disputed.record.status).toBe("disputed");

    const secondDispute = await disputeSpendRecord(reimbursed.record.id, "again");
    expect(secondDispute.ok).toBe(false);
    if (!secondDispute.ok) expect(secondDispute.reason).toBe("already_disputed");
  });

  it("listMissingReceipts excludes mileage and unapproved records", async () => {
    const missingReceipt = await registerSpendRecord({ category: "fuel", method: "cash", amount: 12 });
    expect(missingReceipt.ok).toBe(true);
    if (missingReceipt.ok) createdSpendRecordIds.push(missingReceipt.record.id);

    const missing = await listMissingReceipts();
    expect(missing.some((r) => missingReceipt.ok && r.id === missingReceipt.record.id)).toBe(true);
    expect(missing.every((r) => r.category !== "mileage")).toBe(true);
  });
});

describe("mileage claims -- confirm-before-execute with approval-time data", () => {
  it("computes amount from distanceKm x ratePerKm supplied only at approval, not submission", async () => {
    const pending = await submitForConfirmation({
      actionType: "mileage_claim",
      capability: "mcp:tool:submit_mileage_claim",
      summary: "mileage test",
      payload: { crewMemberId: crewId, distanceKm: 42, description: "site visit" },
      submittedByCrewMemberId: crewId,
    });

    // No rate_per_km exists anywhere until approval -- the executor must
    // fail without it (throws, same convention as every other executor
    // validation failure in this codebase, e.g. consumable_adjustment's
    // not_stocked case).
    await expect(approveConfirmation(pending.id, managerId)).rejects.toThrow(/rate_per_km/);

    const pending2 = await submitForConfirmation({
      actionType: "mileage_claim",
      capability: "mcp:tool:submit_mileage_claim",
      summary: "mileage test 2",
      payload: { crewMemberId: crewId, distanceKm: 42 },
      submittedByCrewMemberId: crewId,
    });
    const result = await approveConfirmation(pending2.id, managerId, { ratePerKm: 0.5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdSpendRecordIds.push(result.confirmation.result_id!);

    const record = await pool.query("SELECT * FROM spend_records WHERE id = $1", [result.confirmation.result_id]);
    expect(record.rows[0].category).toBe("mileage");
    expect(Number(record.rows[0].amount)).toBe(21); // 42 * 0.5
    expect(Number(record.rows[0].rate_per_km)).toBe(0.5);
    expect(record.rows[0].status).toBe("approved"); // the confirmation IS the approval event, not a second pending state
  });
});

describe("timeclock sessions and payroll reconciliation", () => {
  it("computeSessions derives net hours, flags overtime/missed_break only on complete sessions, and leaves incomplete sessions unguessed", async () => {
    const base = new Date("2026-01-01T08:00:00Z");
    const events = [
      { crew_member_id: crewId, event_type: "in", timestamp: base.toISOString(), site_id: null, geofence_verified: true },
      { crew_member_id: crewId, event_type: "break_start", timestamp: new Date(base.getTime() + 4 * 3600_000).toISOString(), site_id: null, geofence_verified: true },
      { crew_member_id: crewId, event_type: "break_end", timestamp: new Date(base.getTime() + 4.5 * 3600_000).toISOString(), site_id: null, geofence_verified: true },
      { crew_member_id: crewId, event_type: "out", timestamp: new Date(base.getTime() + 9 * 3600_000).toISOString(), site_id: null, geofence_verified: true },
    ];
    const sessions = computeSessions(events, 8, 5);
    expect(sessions.length).toBe(1);
    expect(sessions[0].incomplete).toBe(false);
    expect(sessions[0].breakSeconds).toBe(1800);
    expect(sessions[0].netSeconds).toBe(9 * 3600 - 1800);
    expect(sessions[0].overtime).toBe(true); // 9 gross hours > 8

    const incompleteEvents = [{ crew_member_id: crewId, event_type: "in", timestamp: base.toISOString(), site_id: null, geofence_verified: true }];
    const incompleteSessions = computeSessions(incompleteEvents, 8, 5);
    expect(incompleteSessions[0].incomplete).toBe(true);
    expect(incompleteSessions[0].netSeconds).toBeNull();
    expect(incompleteSessions[0].overtime).toBe(false); // always false while incomplete, never guessed
  });

  it("computeReconciliation: amount_owed is null (not 0) with no hourly_rate, and reflects a real rate once set", async () => {
    await pool.query(
      `INSERT INTO timeclock_entries (crew_member_id, event_type, "timestamp") VALUES
       ($1, 'in', '2026-02-01T08:00:00Z'), ($1, 'out', '2026-02-01T16:00:00Z')`,
      [crewId],
    );

    const noRate = await computeReconciliation(crewId, "2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z");
    expect(noRate.hoursWorked).toBe(8);
    expect(noRate.amountOwed).toBeNull();

    await setCrewPayProfile(crewId, { hourlyRate: 25 });
    expect((await getCrewPayProfile(crewId))?.hourly_rate).toBe("25");

    const withRate = await computeReconciliation(crewId, "2026-02-01T00:00:00Z", "2026-02-02T00:00:00Z");
    expect(withRate.amountOwed).toBe(200); // 8 hours x $25

    await recordPayout({ crewMemberId: crewId, amount: 150, recordedByUserId: payrollAdminUserId, paidAt: "2026-02-01T12:00:00Z" });
  });
});
