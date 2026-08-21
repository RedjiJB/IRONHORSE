// Phase 2 slice 1-2 verification: sites, crew_members, job_types, shifts
// domain functions against a real Postgres. Direct domain-layer tests, not
// through MCP -- test/mcp.timeclock-confirmations.test.ts covers the MCP
// wiring + capability-gating layer for the one action (timeclock events)
// that actually needs both layers exercised together.
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { getSite, listSites, registerSite } from "../src/domain/sites.js";
import { getCrewMember, isManagementRole, listCrewMembers, registerCrewMember } from "../src/domain/crewMembers.js";
import { listJobTypes } from "../src/domain/jobTypes.js";
import { assignShift, confirmShift, listShifts } from "../src/domain/shifts.js";

const createdSiteIds: string[] = [];
const createdCrewIds: string[] = [];
const createdShiftIds: string[] = [];

afterAll(async () => {
  await pool.query("DELETE FROM shifts WHERE id = ANY($1)", [createdShiftIds]);
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
  it("registers a crew member with the default 'crew' role", async () => {
    const crew = await registerCrewMember({ name: "QA Test Crew", phone: "+15559990501" });
    createdCrewIds.push(crew.id);
    expect(crew.role).toBe("crew");
    expect(crew.active).toBe(true);
  });

  it("filters by role and active status", async () => {
    const manager = await registerCrewMember({ name: "QA Test Manager", phone: "+15559990502", role: "management" });
    createdCrewIds.push(manager.id);

    const managers = await listCrewMembers({ role: "management" });
    expect(managers.map((c) => c.id)).toContain(manager.id);
    expect(managers.every((c) => c.role === "management")).toBe(true);
  });

  it("isManagementRole is true for management/owner, false otherwise", () => {
    expect(isManagementRole("management")).toBe(true);
    expect(isManagementRole("owner")).toBe(true);
    expect(isManagementRole("crew")).toBe(false);
    expect(isManagementRole("foreman")).toBe(false);
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
