// Dashboard restoration, Slice I: GET /api/v1/sites against a real
// running HTTP server and real Postgres -- no mocking, same convention
// as every other test in this project. Shared-database, potentially-
// concurrent-test-file global list -- assertions find this test's own
// fixture by id within the returned list, never assert on list length.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerSite } from "../src/domain/sites.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { createTimeclockEntry } from "../src/domain/timeclock.js";
import { raiseAlert } from "../src/domain/alerts.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
let adminAccessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdSiteIds: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdTimeclockEntryIds: string[] = [];
const createdAlertIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-sites@example.test", name: "QA Facade Sites User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-sites@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());

  const admin = await registerUser({ email: "qa-facade-sites-admin@example.test", name: "QA Facade Sites Admin", password: "correct-password-123", role: "admin" });
  createdUserIds.push(admin.id);
  createdUserDids.push(admin.did);

  const adminLogin = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-sites-admin@example.test", password: "correct-password-123" }),
  });
  ({ access_token: adminAccessToken } = await adminLogin.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM timeclock_entries WHERE id = ANY($1)", [createdTimeclockEntryIds]);
  await pool.query("DELETE FROM notifications WHERE source_id = ANY($1)", [createdAlertIds]);
  await pool.query("DELETE FROM alerts WHERE id = ANY($1)", [createdAlertIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
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

function asAdmin(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${adminAccessToken}` },
  });
}

describe("GET /api/v1/sites", () => {
  it("lists a registered site with its real address and coordinates", async () => {
    const site = await registerSite({
      name: "QA Facade Test Yard",
      type: "depot",
      address: "123 QA Test Road, Ottawa, ON",
      centerLat: 45.42,
      centerLng: -75.69,
    });
    createdSiteIds.push(site.id);

    const res = await authed("/api/v1/sites");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);

    const found = body.items.find((s: { id: string }) => s.id === site.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe("QA Facade Test Yard");
    expect(found.type).toBe("depot");
    expect(found.address).toBe("123 QA Test Road, Ottawa, ON");
    expect(found.lat).toBe(45.42);
    expect(found.lng).toBe(-75.69);
    expect(found.crew_today_count).toBe(0);
    expect(found.open_alerts_count).toBe(0);
  });

  it("counts crew clocked in today and open alerts at the site", async () => {
    const site = await registerSite({ name: "QA Facade Activity Yard", type: "job_site" });
    createdSiteIds.push(site.id);

    const crew = await registerCrewMember({ name: "QA Facade Sites Crew", phone: "+15559991902" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);
    const clockIn = await createTimeclockEntry({ crewMemberId: crew.id, eventType: "in", siteId: site.id, geofenceVerified: false });
    createdTimeclockEntryIds.push(clockIn.id);

    const { alert } = await raiseAlert({ type: "weather", summary: "QA facade sites test alert", siteId: site.id });
    createdAlertIds.push(alert.id);

    const res = await authed("/api/v1/sites");
    const body = await res.json();
    const found = body.items.find((s: { id: string }) => s.id === site.id);
    expect(found).toBeTruthy();
    expect(found.crew_today_count).toBe(1);
    expect(found.open_alerts_count).toBe(1);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/sites`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/sites", () => {
  it("registers a site from lat/lng, admin-gated, and it appears in the list", async () => {
    const res = await asAdmin("/api/v1/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Facade Created Site", type: "job_site", lat: 45.4, lng: -75.7 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    createdSiteIds.push(body.id);
    expect(body.name).toBe("QA Facade Created Site");
    expect(body.type).toBe("job_site");
    expect(body.lat).toBe(45.4);
    expect(body.lng).toBe(-75.7);
    expect(body.crew_today_count).toBe(0);
    expect(body.open_alerts_count).toBe(0);

    const list = await authed("/api/v1/sites");
    const listBody = await list.json();
    expect(listBody.items.some((s: { id: string }) => s.id === body.id)).toBe(true);
  });

  it("403s for a staff (non-admin) requester", async () => {
    const res = await authed("/api/v1/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Facade Should Not Create", type: "job_site", lat: 45.4, lng: -75.7 }),
    });
    expect(res.status).toBe(403);
  });

  it("422s when neither lat/lng nor an address is provided", async () => {
    const res = await asAdmin("/api/v1/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Facade Missing Location", type: "job_site" }),
    });
    expect(res.status).toBe(422);
  });

  it("422s for a missing name or an invalid type", async () => {
    const noName = await asAdmin("/api/v1/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "job_site", lat: 45.4, lng: -75.7 }),
    });
    expect(noName.status).toBe(422);

    const badType = await asAdmin("/api/v1/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Facade Bad Type", type: "not_a_real_type", lat: 45.4, lng: -75.7 }),
    });
    expect(badType.status).toBe(422);
  });
});
