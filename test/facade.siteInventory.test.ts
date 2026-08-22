// Task #156, Slice E verification (site-inventory half): the
// site-inventory façade routes against a real running HTTP server and
// real Postgres -- no mocking, same convention as every other test in
// this project.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerConsumable } from "../src/domain/consumables.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdConsumableIds: string[] = [];
const FAKE_PROJECT_ID = "fake-project-id";

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-siteinv@example.test", name: "QA Facade Site Inventory User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-siteinv@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM consumables WHERE id = ANY($1)", [createdConsumableIds]);
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

describe("POST /api/v1/site-inventory/projects/:projectId/items", () => {
  it("creates a stocked consumable, ignoring the (nonexistent) projectId", async () => {
    const res = await authed(`/api/v1/site-inventory/projects/${FAKE_PROJECT_ID}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Poly Sand", unit: "bag", reorder_point: "10" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    createdConsumableIds.push(body.id);
    expect(body.name).toBe("QA Poly Sand");
    expect(body.unit).toBe("bag");
    expect(body.project_id).toBe(FAKE_PROJECT_ID); // echoed back, not persisted anywhere
  });

  it("422s without a name", async () => {
    const res = await authed(`/api/v1/site-inventory/projects/${FAKE_PROJECT_ID}/items`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/site-inventory/projects/:projectId/items", () => {
  it("returns a bare array (not a Page envelope), org-wide regardless of projectId", async () => {
    const res = await authed(`/api/v1/site-inventory/projects/${FAKE_PROJECT_ID}/items`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.some((i: { id: string }) => i.id === createdConsumableIds[0])).toBe(true);

    // A different (also fake) projectId sees the exact same org-wide list.
    const otherProject = await authed("/api/v1/site-inventory/projects/some-other-fake-id/items");
    const otherBody = await otherProject.json();
    expect(otherBody.some((i: { id: string }) => i.id === createdConsumableIds[0])).toBe(true);
  });
});

describe("GET /api/v1/site-inventory/projects/:projectId/stock-on-hand", () => {
  it("includes only 'stocked' consumables, excluding 'per_job_delivery' ones", async () => {
    const stocked = await registerConsumable({ name: "QA Stocked Item", unit: "bag", stockingType: "stocked" });
    createdConsumableIds.push(stocked.id);
    const perJob = await registerConsumable({ name: "QA Per-Job Item", unit: "sqft", stockingType: "per_job_delivery" });
    createdConsumableIds.push(perJob.id);

    const res = await authed(`/api/v1/site-inventory/projects/${FAKE_PROJECT_ID}/stock-on-hand`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows.some((r: { item_id: string }) => r.item_id === stocked.id)).toBe(true);
    expect(body.rows.some((r: { item_id: string }) => r.item_id === perJob.id)).toBe(false);
  });
});

describe("locations and movements (deliberately omitted)", () => {
  it("404s, isolated -- no locations or movement-ledger concept exists in this domain", async () => {
    const locations = await authed(`/api/v1/site-inventory/projects/${FAKE_PROJECT_ID}/locations`);
    expect(locations.status).toBe(404);

    const movements = await authed(`/api/v1/site-inventory/projects/${FAKE_PROJECT_ID}/movements`);
    expect(movements.status).toBe(404);
  });
});
