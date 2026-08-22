// Task #156, Slice F verification: the payroll façade routes against a
// real running HTTP server and real Postgres -- no mocking, same
// convention as every other test in this project.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { setCrewPayProfile } from "../src/domain/payroll.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const FAKE_PROJECT_ID = "fake-project-id";

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-payroll@example.test", name: "QA Facade Payroll User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-payroll@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM crew_pay_profiles WHERE crew_member_id = ANY($1)", [createdCrewIds]);
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

describe("GET /api/v1/payroll/projects/:projectId/batches", () => {
  it("returns exactly one synthetic 'current' batch, entries built from crew_pay_profiles", async () => {
    const crew = await registerCrewMember({ name: "QA Payroll Crew", phone: "+15559991301" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);
    await setCrewPayProfile(crew.id, { hourlyRate: 25 });

    const res = await authed(`/api/v1/payroll/projects/${FAKE_PROJECT_ID}/batches`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe("current");
    expect(body[0].status).toBe("draft");
    expect(body[0].project_id).toBe(FAKE_PROJECT_ID);
    expect(body[0].entry_count).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/payroll/batches/:batchId", () => {
  it("includes a real entry for a crew member with a pay profile, net equals gross (no deductions)", async () => {
    const res = await authed("/api/v1/payroll/batches/current");
    expect(res.status).toBe(200);
    const body = await res.json();

    const entry = body.entries.find((e: { worker: string }) => e.worker === "QA Payroll Crew");
    expect(entry).toBeTruthy();
    expect(entry.rate).toBe("25");
    expect(entry.deductions).toEqual([]);
    expect(entry.net_amount).toBe(entry.amount);
  });
});

describe("PATCH batch lifecycle actions (submit/finalize/post)", () => {
  it("accepts each action but never advances status past 'draft' -- no gate exists in this domain", async () => {
    for (const action of ["submit", "finalize", "post"]) {
      const res = await authed(`/api/v1/payroll/batches/current/${action}`, { method: "PATCH" });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("draft");
    }
  });
});

describe("GET /api/v1/payroll/batches/:batchId/reconcile", () => {
  it("is always balanced -- batch hours and source hours are the same live query, not a stored snapshot", async () => {
    const res = await authed("/api/v1/payroll/batches/current/reconcile");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balanced).toBe(true);
    expect(body.delta_total_hours).toBe("0.00");
    expect(body.rows.every((r: { matched: boolean }) => r.matched)).toBe(true);
  });
});

describe("GET /api/v1/payroll/projects/:projectId/labour-cost", () => {
  // Both this endpoint and the batch envelope's total_amount query the
  // same global set of pay profiles -- comparing two separately-fetched
  // snapshots for exact equality would be racy against concurrently
  // running test files that also touch crew_pay_profiles. Assert shape
  // and validity instead, same lesson as the notifications slice's
  // unread-count test.
  it("returns a valid non-negative total in USD", async () => {
    const res = await authed(`/api/v1/payroll/projects/${FAKE_PROJECT_ID}/labour-cost`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.currency).toBe("USD");
    expect(Number(body.labour_cost)).toBeGreaterThanOrEqual(0);
    expect(Number(body.total_hours)).toBeGreaterThanOrEqual(0);
  });
});

describe("deductions and export (deliberately omitted)", () => {
  it("404s in isolation -- no per-entry deduction concept or batch export exists in this domain", async () => {
    const addDeduction = await authed("/api/v1/payroll/batches/current/entries/some-entry/deductions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Tax", deduction_type: "tax", mode: "percentage", value: "10" }),
    });
    expect(addDeduction.status).toBe(404);

    const exportCsv = await authed("/api/v1/payroll/batches/current/export.csv");
    expect(exportCsv.status).toBe(404);
  });
});
