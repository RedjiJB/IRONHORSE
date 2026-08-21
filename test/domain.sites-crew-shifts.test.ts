// Phase 2 slice 1-2 verification: sites, crew_members, job_types, shifts
// domain functions against a real Postgres. Direct domain-layer tests, not
// through MCP -- test/mcp.timeclock-confirmations.test.ts covers the MCP
// wiring + capability-gating layer for the one action (timeclock events)
// that actually needs both layers exercised together.
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { getSite, listSites, registerSite } from "../src/domain/sites.js";
import { getCrewMember, hasManagementCapability, listCrewMembers, registerCrewMember } from "../src/domain/crewMembers.js";
import { listJobTypes } from "../src/domain/jobTypes.js";
import { assignShift, confirmShift, listShifts } from "../src/domain/shifts.js";

const createdSiteIds: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdShiftIds: string[] = [];

afterAll(async () => {
  await pool.query("DELETE FROM shifts WHERE id = ANY($1)", [createdShiftIds]);
  // Every registerCrewMember call also issues real credentials -- clean
  // those up too, not just the crew_members row itself.
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
  await pool.end();
});

describe("sites", () => {
  it("registers a site and reads it back by id and by list", async () => {
    const site = await registerSite({
      name: "QA Test Site",
      type: "job_site",
      address: "123 Test St",
      centerLat: 45.4,
      centerLng: -75.7,
      geofenceRadiusM: 100,
    });
    createdSiteIds.push(site.id);

    expect(site.name).toBe("QA Test Site");
    expect(site.type).toBe("job_site");

    const fetched = await getSite(site.id);
    expect(fetched?.id).toBe(site.id);

    const list = await listSites({ type: "job_site" });
    expect(list.map((s) => s.id)).toContain(site.id);
  });

  it("returns null for a nonexistent site", async () => {
    expect(await getSite("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("crew_members", () => {
  it("registers a crew member with a real DID and a signed PhoneBinding credential, not just a phone column", async () => {
    const crew = await registerCrewMember({ name: "QA Test Crew", phone: "+15559990501" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    expect(crew.role).toBe("crew");
    expect(crew.active).toBe(true);
    expect(crew.did).toMatch(/^did:web:.+:crew:[0-9a-f-]{36}$/);

    // The DID is custodially held -- confirm this node actually generated
    // and stored a real keypair for it, not just a string.
    const key = await pool.query("SELECT public_jwk FROM keys WHERE did = $1", [crew.did]);
    expect(key.rowCount).toBe(1);

    // A real signed credential exists binding this DID to the phone
    // number -- not just the crew_members.phone column asserting it.
    const vc = await pool.query(
      "SELECT credential_type, subject_did FROM verifiable_credentials WHERE subject_did = $1",
      [crew.did],
    );
    expect(vc.rows.some((r) => r.credential_type === "PhoneBinding")).toBe(true);
  });

  it("filters by role and active status", async () => {
    const manager = await registerCrewMember({ name: "QA Test Manager", phone: "+15559990502", role: "management" });
    createdCrewIds.push(manager.id);
    createdCrewDids.push(manager.did);

    const managers = await listCrewMembers({ role: "management" });
    expect(managers.map((c) => c.id)).toContain(manager.id);
    expect(managers.every((c) => c.role === "management")).toBe(true);
  });

  it("hasManagementCapability is true for management/owner, false for crew/foreman -- backed by a real capability grant, not a role string", async () => {
    const crew = await registerCrewMember({ name: "QA Test Plain Crew", phone: "+15559990504" });
    const foreman = await registerCrewMember({ name: "QA Test Foreman", phone: "+15559990505", role: "foreman" });
    const manager = await registerCrewMember({ name: "QA Test Management", phone: "+15559990506", role: "management" });
    const owner = await registerCrewMember({ name: "QA Test Owner", phone: "+15559990507", role: "owner" });
    for (const c of [crew, foreman, manager, owner]) {
      createdCrewIds.push(c.id);
      createdCrewDids.push(c.did);
    }

    expect(await hasManagementCapability(crew.did)).toBe(false);
    expect(await hasManagementCapability(foreman.did)).toBe(false);
    expect(await hasManagementCapability(manager.did)).toBe(true);
    expect(await hasManagementCapability(owner.did)).toBe(true); // owner implies management, matching v1's convention

    // Confirm it's a real grant, not a hardcoded role list -- revoking it
    // actually changes the answer.
    const grant = await pool.query(
      "SELECT id FROM capability_grants WHERE subject_did = $1 AND capability = 'crew:role:management'",
      [manager.did],
    );
    await pool.query("UPDATE capability_grants SET revoked_at = now() WHERE id = $1", [grant.rows[0].id]);
    expect(await hasManagementCapability(manager.did)).toBe(false);
  });

  it("returns null for a nonexistent crew member", async () => {
    expect(await getCrewMember("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});

describe("job_types", () => {
  it("lists the seeded job types", async () => {
    const jobTypes = await listJobTypes();
    const names = jobTypes.map((jt) => jt.name);
    expect(names).toContain("sod_install");
    expect(names).toContain("interlock_repair");
    expect(names.length).toBe(8); // matches v1's documented seed set exactly
  });
});

describe("shifts", () => {
  it("assigns a shift, defaults to 'assigned' status, then confirms it", async () => {
    const site = await registerSite({ name: "QA Test Shift Site", type: "job_site" });
    createdSiteIds.push(site.id);
    const crew = await registerCrewMember({ name: "QA Test Shift Crew", phone: "+15559990503" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const shift = await assignShift({ crewMemberId: crew.id, siteId: site.id, date: "2026-08-25", startTime: "08:00" });
    createdShiftIds.push(shift.id);
    expect(shift.status).toBe("assigned");

    const confirmed = await confirmShift(shift.id, "confirmed");
    expect(confirmed?.status).toBe("confirmed");

    const forCrew = await listShifts({ crewMemberId: crew.id });
    expect(forCrew.map((s) => s.id)).toContain(shift.id);
  });

  it("confirmShift returns null for a nonexistent shift", async () => {
    expect(await confirmShift("00000000-0000-0000-0000-000000000000", "confirmed")).toBeNull();
  });
});
