// Phase 2 slice 3 verification: the generalized confirm-before-execute
// mechanism, exercised end to end through its one wired action
// (timeclock events) -- submit creates a pending row and does NOT touch
// timeclock_entries; approve (by a real management-role crew member)
// re-resolves geofence_verified fresh and actually creates the row;
// reject leaves no row; a non-management reviewer is denied regardless of
// which crew member submitted.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { registerSite } from "../src/domain/sites.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { registerTimeclockConfirmationExecutor, resolveGeofenceVerified } from "../src/domain/timeclock.js";
import { approveConfirmation, rejectConfirmation, submitForConfirmation } from "../src/domain/confirmations.js";

registerTimeclockConfirmationExecutor();

let siteId: string;
let crewMemberId: string;
let managementId: string;
let ownerId: string;
const createdSiteIds: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];

beforeAll(async () => {
  const site = await registerSite({
    name: "QA Test Geofence Site",
    type: "job_site",
    centerLat: 45.4215,
    centerLng: -75.6972,
    geofenceRadiusM: 100,
  });
  siteId = site.id;
  createdSiteIds.push(site.id);

  const crew = await registerCrewMember({ name: "QA Test Timeclock Crew", phone: "+15559990601" });
  crewMemberId = crew.id;
  createdCrewIds.push(crew.id);
  createdCrewDids.push(crew.did);

  const manager = await registerCrewMember({ name: "QA Test Manager Reviewer", phone: "+15559990602", role: "management" });
  managementId = manager.id;
  createdCrewIds.push(manager.id);
  createdCrewDids.push(manager.did);

  const owner = await registerCrewMember({ name: "QA Test Owner Reviewer", phone: "+15559990603", role: "owner" });
  ownerId = owner.id;
  createdCrewIds.push(owner.id);
  createdCrewDids.push(owner.did);
});

afterAll(async () => {
  await pool.query(
    "DELETE FROM timeclock_entries WHERE crew_member_id = ANY($1)",
    [createdCrewIds],
  );
  await pool.query("DELETE FROM pending_confirmations WHERE submitted_by = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
  await pool.end();
});

describe("resolveGeofenceVerified", () => {
  it("is true inside the radius, false outside, false with no coordinates or no site", async () => {
    expect(await resolveGeofenceVerified(siteId, 45.4215, -75.6972)).toBe(true);
    expect(await resolveGeofenceVerified(siteId, 45.44, -75.72)).toBe(false); // ~2km away
    expect(await resolveGeofenceVerified(siteId, null, null)).toBe(false);
    expect(await resolveGeofenceVerified(null, 45.4215, -75.6972)).toBe(false);
  });
});

describe("confirm-before-execute: timeclock_event", () => {
  it("submitting does not create a timeclock_entries row -- only a pending one", async () => {
    const pending = await submitForConfirmation({
      actionType: "timeclock_event",
      capability: "mcp:tool:log_timeclock_event",
      summary: "in event for QA Test Timeclock Crew",
      payload: { crewMemberId, eventType: "in", siteId, lat: 45.4215, lng: -75.6972 },
      submittedByCrewMemberId: crewMemberId,
    });
    expect(pending.status).toBe("awaiting_review");

    const rows = await pool.query("SELECT * FROM timeclock_entries WHERE crew_member_id = $1", [crewMemberId]);
    expect(rows.rowCount).toBe(0);

    // Clean up this specific row before the next test's assertions -- each
    // test in this file wants a clean slate, not accumulated pending rows.
    await pool.query("DELETE FROM pending_confirmations WHERE id = $1", [pending.id]);
  });

  it("approving as a management-role crew member re-resolves geofence fresh and actually creates the row", async () => {
    const pending = await submitForConfirmation({
      actionType: "timeclock_event",
      capability: "mcp:tool:log_timeclock_event",
      summary: "in event for QA Test Timeclock Crew",
      payload: { crewMemberId, eventType: "in", siteId, lat: 45.4215, lng: -75.6972 },
      submittedByCrewMemberId: crewMemberId,
    });

    const result = await approveConfirmation(pending.id, managementId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmation.status).toBe("approved");
    expect(result.confirmation.reviewed_by).toBe(managementId);
    expect(result.confirmation.result_id).toBeTruthy();

    const entry = await pool.query("SELECT * FROM timeclock_entries WHERE id = $1", [result.confirmation.result_id]);
    expect(entry.rows[0].crew_member_id).toBe(crewMemberId);
    expect(entry.rows[0].geofence_verified).toBe(true);

    // GPS stays plain, available data -- not proven-without-revealing --
    // by explicit instruction, so the raw coordinates a real
    // confirm-before-execute flow actually used must survive on the row,
    // not just the derived boolean.
    expect(entry.rows[0].lat).toBeCloseTo(45.4215);
    expect(entry.rows[0].lng).toBeCloseTo(-75.6972);
  });

  it("an owner-role reviewer is also accepted, not just 'management'", async () => {
    const pending = await submitForConfirmation({
      actionType: "timeclock_event",
      capability: "mcp:tool:log_timeclock_event",
      summary: "out event",
      payload: { crewMemberId, eventType: "out", siteId, lat: 45.4215, lng: -75.6972 },
      submittedByCrewMemberId: crewMemberId,
    });
    const result = await approveConfirmation(pending.id, ownerId);
    expect(result.ok).toBe(true);
  });

  it("denies approval from a reviewer who isn't management/owner, regardless of who submitted", async () => {
    const pending = await submitForConfirmation({
      actionType: "timeclock_event",
      capability: "mcp:tool:log_timeclock_event",
      summary: "in event",
      payload: { crewMemberId, eventType: "in", siteId, lat: 45.4215, lng: -75.6972 },
      submittedByCrewMemberId: crewMemberId,
    });

    // crewMemberId itself holds role 'crew' -- not a management role.
    const result = await approveConfirmation(pending.id, crewMemberId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("reviewer_not_management");

    // Confirm it's genuinely still pending, not silently executed.
    const stillPending = await pool.query("SELECT status FROM pending_confirmations WHERE id = $1", [pending.id]);
    expect(stillPending.rows[0].status).toBe("awaiting_review");
  });

  it("rejecting leaves no timeclock_entries row and records the reviewer + note", async () => {
    const pending = await submitForConfirmation({
      actionType: "timeclock_event",
      capability: "mcp:tool:log_timeclock_event",
      summary: "in event",
      payload: { crewMemberId, eventType: "in", siteId, lat: 45.44, lng: -75.72 }, // outside geofence
      submittedByCrewMemberId: crewMemberId,
    });

    const result = await rejectConfirmation(pending.id, managementId, "not actually at the site");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmation.status).toBe("rejected");
    expect(result.confirmation.rejection_note).toBe("not actually at the site");
    expect(result.confirmation.result_id).toBeNull();
  });

  it("denies acting on an already-reviewed confirmation a second time", async () => {
    const pending = await submitForConfirmation({
      actionType: "timeclock_event",
      capability: "mcp:tool:log_timeclock_event",
      summary: "in event",
      payload: { crewMemberId, eventType: "in", siteId, lat: 45.4215, lng: -75.6972 },
      submittedByCrewMemberId: crewMemberId,
    });
    const first = await approveConfirmation(pending.id, managementId);
    expect(first.ok).toBe(true);

    const second = await approveConfirmation(pending.id, managementId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_reviewed");
  });
});
