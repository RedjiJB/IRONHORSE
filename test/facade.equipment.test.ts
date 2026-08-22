// Task #156, Slice D verification: the equipment façade routes against a
// real running HTTP server and real Postgres -- no mocking, same
// convention as every other test in this project.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { logVehicleTelemetry } from "../src/domain/telemetry.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdVehicleIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-equipment@example.test", name: "QA Facade Equipment User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-equipment@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM vehicle_telemetry WHERE vehicle_id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM vehicles WHERE id = ANY($1)", [createdVehicleIds]);
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

describe("POST /api/v1/equipment/equipment", () => {
  it("creates a vehicle from code, mapped onto the frontend's Equipment shape", async () => {
    const res = await authed("/api/v1/equipment/equipment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "QA-EQUIP-001", name: "ignored, no backing field", odometer_km: 1234 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    createdVehicleIds.push(body.id);

    expect(body.code).toBe("QA-EQUIP-001");
    expect(body.name).toBe("QA-EQUIP-001"); // no separate name field -- mirrors code
    expect(body.type_code).toBe("vehicle");
    expect(body.ownership).toBe("owned");
    expect(body.status).toBe("active");
    expect(body.currency).toBe("USD");
    expect(Number(body.odometer_km)).toBe(1234);
    expect(body.location_lat).toBeNull();
  });

  it("422s without a code", async () => {
    const res = await authed("/api/v1/equipment/equipment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/equipment/equipment", () => {
  it("lists equipment with the Page<T> envelope, latest telemetry mapped onto location fields", async () => {
    const create = await authed("/api/v1/equipment/equipment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "QA-EQUIP-002" }),
    });
    const created = await create.json();
    createdVehicleIds.push(created.id);

    await logVehicleTelemetry({ vehicleId: created.id, lat: 45.4215, lng: -75.6972 });

    const res = await authed("/api/v1/equipment/equipment?limit=100&offset=0");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
    expect(typeof body.total).toBe("number");

    const found = body.items.find((e: { code: string }) => e.code === "QA-EQUIP-002");
    expect(found).toBeTruthy();
    expect(found.location_lat).toBe(45.4215);
    expect(found.location_lng).toBe(-75.6972);
    expect(found.last_telemetry_at).toBeTruthy();
  });

  it("emulates status/type/ownership filters against the fixed stub values -- anything else returns empty", async () => {
    const matching = await authed("/api/v1/equipment/equipment?status=active&type=vehicle&ownership=owned");
    const matchingBody = await matching.json();
    expect(matchingBody.total).toBeGreaterThan(0);

    const nonMatching = await authed("/api/v1/equipment/equipment?status=decommissioned");
    const nonMatchingBody = await nonMatching.json();
    expect(nonMatchingBody.total).toBe(0);
    expect(nonMatchingBody.items).toEqual([]);
  });
});

describe("GET /api/v1/equipment/equipment/:id", () => {
  it("fetches a single vehicle, 404s for a nonexistent one", async () => {
    const create = await authed("/api/v1/equipment/equipment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "QA-EQUIP-003" }),
    });
    const created = await create.json();
    createdVehicleIds.push(created.id);

    const res = await authed(`/api/v1/equipment/equipment/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("QA-EQUIP-003");

    const missing = await authed("/api/v1/equipment/equipment/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
  });
});

describe("PATCH /api/v1/equipment/equipment/:id", () => {
  it("updates only the fields with real backing (code -> plate, odometer_km -> current_mileage)", async () => {
    const create = await authed("/api/v1/equipment/equipment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "QA-EQUIP-004", odometer_km: 100 }),
    });
    const created = await create.json();
    createdVehicleIds.push(created.id);

    const res = await authed(`/api/v1/equipment/equipment/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ odometer_km: 500 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("QA-EQUIP-004"); // unchanged
    expect(Number(body.odometer_km)).toBe(500);
  });
});

describe("GET /api/v1/equipment/equipment/:id/telemetry", () => {
  it("lists telemetry as a bare array mapped onto TelemetryReading", async () => {
    const create = await authed("/api/v1/equipment/equipment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "QA-EQUIP-005" }),
    });
    const created = await create.json();
    createdVehicleIds.push(created.id);
    await logVehicleTelemetry({ vehicleId: created.id, lat: 1, lng: 2 });
    await logVehicleTelemetry({ vehicleId: created.id, lat: 3, lng: 4 });

    const res = await authed(`/api/v1/equipment/equipment/${created.id}/telemetry`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    expect(body[0].equipment_id).toBe(created.id);
  });
});

describe("GET /api/v1/equipment/types", () => {
  it("returns the one real type this backend has", async () => {
    const res = await authed("/api/v1/equipment/types");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([{ id: "vehicle", code: "vehicle", name: "Vehicle", category: "fleet" }]);
  });
});
