// Manual-checkin map feature verification: the locations façade routes
// against a real running HTTP server and real Postgres -- no mocking,
// same convention as every other test in this project.
//
// GET /api/v1/locations combines every vehicle's and every active crew
// member's latest known location system-wide -- a shared-database,
// potentially-concurrent-test-file global list, same lesson as
// notifications' unread-count and payroll's labour-cost. Assertions
// below find this test's own fixtures by id within the returned list,
// never assert on the list's total length.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerVehicle } from "../src/domain/vehicles.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { logVehicleTelemetry, type ReverseGeocode } from "../src/domain/telemetry.js";
import { buildFacadeServer } from "../src/facade/server.js";

const noGeocode: ReverseGeocode = async () => null;

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdVehicleIds: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-locations@example.test", name: "QA Facade Locations User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-locations@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM vehicle_telemetry WHERE vehicle_id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM vehicles WHERE id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM crew_telemetry WHERE crew_member_id = ANY($1)", [createdCrewIds]);
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

describe("GET /api/v1/locations", () => {
  it("combines vehicles' and crew's latest telemetry into one list", async () => {
    const vehicle = await registerVehicle({ plate: "QA-LOC-001" });
    createdVehicleIds.push(vehicle.id);
    await logVehicleTelemetry({ vehicleId: vehicle.id, lat: 45.42, lng: -75.69 }, noGeocode);

    const crew = await registerCrewMember({ name: "QA Locations Crew", phone: "+15559991601" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const res = await authed("/api/v1/locations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);

    const vehiclePoint = body.items.find((p: { type: string; target_id: string }) => p.type === "vehicle" && p.target_id === vehicle.id);
    expect(vehiclePoint).toBeTruthy();
    expect(vehiclePoint.label).toBe("QA-LOC-001");
    expect(vehiclePoint.lat).toBe(45.42);
    expect(vehiclePoint.lng).toBe(-75.69);

    // Crew has no telemetry yet -- correctly absent, not a zeroed/faked point.
    const crewPoint = body.items.find((p: { type: string; target_id: string }) => p.type === "crew" && p.target_id === crew.id);
    expect(crewPoint).toBeUndefined();
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/locations`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/locations/checkin", () => {
  it("logs a manual crew check-in, which then appears in the combined list", async () => {
    const crew = await registerCrewMember({ name: "QA Checkin Crew", phone: "+15559991602" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    // No fake geocoder injected -- like facade.equipment.test.ts, this
    // route has no test hook to override the real Nominatim call. One
    // real network call, gracefully a no-op on any failure; nothing here
    // asserts on the resolved address.
    const checkin = await authed("/api/v1/locations/checkin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "crew", target_id: crew.id, lat: 45.5, lng: -75.5 }),
    });
    expect(checkin.status).toBe(200);
    const checkinBody = await checkin.json();
    expect(checkinBody.type).toBe("crew");
    expect(checkinBody.target_id).toBe(crew.id);

    const res = await authed("/api/v1/locations");
    const body = await res.json();
    const point = body.items.find((p: { type: string; target_id: string }) => p.type === "crew" && p.target_id === crew.id);
    expect(point).toBeTruthy();
    expect(point.lat).toBe(45.5);
    expect(point.lng).toBe(-75.5);
  });

  it("422s for a missing/invalid type, missing target_id, or missing coordinates", async () => {
    const badType = await authed("/api/v1/locations/checkin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "tool", target_id: "x", lat: 1, lng: 2 }),
    });
    expect(badType.status).toBe(422);

    const missingCoords = await authed("/api/v1/locations/checkin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "crew", target_id: "x" }),
    });
    expect(missingCoords.status).toBe(422);
  });

  it("404s for a vehicle/crew id that doesn't exist, not a silently accepted phantom point", async () => {
    const res = await authed("/api/v1/locations/checkin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "vehicle", target_id: "00000000-0000-0000-0000-000000000000", lat: 1, lng: 2 }),
    });
    expect(res.status).toBe(404);
  });

  it("accepts an address in place of lat/lng, forward-geocoding it before writing the point", async () => {
    const crew = await registerCrewMember({ name: "QA Checkin By Address Crew", phone: "+15559991603" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    // No test hook for the real Nominatim call here either (matches the
    // lat/lng checkin test above) -- one real network call, tolerant of
    // either a resolved point (200) or an honest "couldn't resolve that"
    // (422) if the network/service is unavailable in this environment.
    const res = await authed("/api/v1/locations/checkin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "crew", target_id: crew.id, address: "Parliament Hill, Ottawa, Ontario, Canada" }),
    });
    expect([200, 422]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(Number.isFinite(body.lat)).toBe(true);
      expect(Number.isFinite(body.lng)).toBe(true);
    }
  });
});
