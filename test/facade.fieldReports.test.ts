// Restoring Field Reports, Slice S: GET/POST /api/v1/field-reports
// against a real running HTTP server and real Postgres -- no mocking,
// same convention as every other test in this project. Exercises the
// real derived workforce/equipment context: a real timeclock entry and
// a real vehicle telemetry ping inside the site's geofence must both
// surface on the report, not just the stored notes.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { registerSite } from "../src/domain/sites.js";
import { registerVehicle } from "../src/domain/vehicles.js";
import { createTimeclockEntry } from "../src/domain/timeclock.js";
import { logVehicleTelemetry, type ReverseGeocode } from "../src/domain/telemetry.js";
import { buildFacadeServer } from "../src/facade/server.js";

const noGeocode: ReverseGeocode = async () => null;

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdSiteIds: string[] = [];
const createdVehicleIds: string[] = [];
const createdReportIds: string[] = [];
const createdTimeclockEntryIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-fieldreports@example.test", name: "QA Facade Field Reports User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-fieldreports@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM field_reports WHERE id = ANY($1)", [createdReportIds]);
  await pool.query("DELETE FROM timeclock_entries WHERE id = ANY($1)", [createdTimeclockEntryIds]);
  await pool.query("DELETE FROM vehicle_telemetry WHERE vehicle_id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM vehicles WHERE id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [createdUserIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
  await pool.end();
});

function authed(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
  });
}

describe("GET/POST /api/v1/field-reports", () => {
  it("creates a report and derives real workforce + equipment context from it", async () => {
    const site = await registerSite({ name: "QA Field Report Site", type: "job_site", centerLat: 45.42, centerLng: -75.69, geofenceRadiusM: 300 });
    createdSiteIds.push(site.id);

    const crew = await registerCrewMember({ name: "QA Field Report Crew", phone: "+15559990030" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const today = new Date().toISOString().slice(0, 10);
    const clockIn = await createTimeclockEntry({ crewMemberId: crew.id, eventType: "in", siteId: site.id, geofenceVerified: true });
    createdTimeclockEntryIds.push(clockIn.id);

    const vehicle = await registerVehicle({ plate: "QA-FR-001" });
    createdVehicleIds.push(vehicle.id);
    // Inside the 300m geofence -- a tiny offset from the site center.
    await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.4202, lng: -75.6902 }, noGeocode);

    const create = await authed("/api/v1/field-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_id: site.id, report_date: today, notes: "QA test field report notes" }),
    });
    expect(create.status).toBe(200);
    const created = await create.json();
    createdReportIds.push(created.id);
    expect(created.notes).toBe("QA test field report notes");

    const list = await authed(`/api/v1/field-reports?site_id=${site.id}`);
    const listBody = await list.json();
    expect(listBody.items.find((r: { id: string }) => r.id === created.id).site_name).toBe("QA Field Report Site");

    const detail = await authed(`/api/v1/field-reports/${created.id}`);
    expect(detail.status).toBe(200);
    const detailBody = await detail.json();
    expect(detailBody.site_name).toBe("QA Field Report Site");
    expect(detailBody.author_name).toBe("QA Facade Field Reports User");
    expect(detailBody.workforce.find((w: { crew_member_id: string }) => w.crew_member_id === crew.id)).toBeTruthy();
    expect(detailBody.equipment.find((e: { vehicle_id: string }) => e.vehicle_id === vehicle.id)).toBeTruthy();
  });

  it("422s when required fields are missing", async () => {
    const res = await authed("/api/v1/field-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "missing site and date" }),
    });
    expect(res.status).toBe(422);
  });

  it("404s for an unknown report id", async () => {
    const res = await authed("/api/v1/field-reports/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/field-reports`);
    expect(res.status).toBe(401);
  });
});
