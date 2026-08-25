// Task #156, Slice H verification: the field-time façade routes against
// a real running HTTP server and real Postgres -- no mocking, same
// convention as every other test in this project.
//
// Uses a fixed historical date (2026-01-15) with an explicit
// date_from/date_to window on every request, rather than "the current
// month" the route defaults to -- the same test-isolation lesson learned
// in notifications/payroll: this is a shared dev/test database, and
// scoping to a narrow, explicit window that only this test's own fixture
// rows fall inside is what keeps assertions safe alongside concurrently
// running test files.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const FAKE_PROJECT_ID = "fake-project-id";
const WINDOW = "date_from=2026-01-15T00:00:00.000Z&date_to=2026-01-15T23:59:59.999Z";
let crewId: string;
let timesheetId: string;

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-field-time@example.test", name: "QA Facade Field Time User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-field-time@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());

  const crew = await registerCrewMember({ name: "QA Field Time Crew", phone: "+15559991501" });
  crewId = crew.id;
  createdCrewIds.push(crew.id);
  createdCrewDids.push(crew.did);
  timesheetId = `${crewId}:2026-01-15`;

  await pool.query(
    `INSERT INTO timeclock_entries (crew_member_id, event_type, "timestamp") VALUES
     ($1, 'in', '2026-01-15T08:00:00Z'),
     ($1, 'break_start', '2026-01-15T12:00:00Z'),
     ($1, 'break_end', '2026-01-15T12:30:00Z'),
     ($1, 'out', '2026-01-15T16:30:00Z')`,
    [crewId],
  );
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM timeclock_entries WHERE crew_member_id = ANY($1)", [createdCrewIds]);
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

describe("GET /api/v1/field-time/timesheets/", () => {
  it("synthesizes one timesheet per crew member per day, one line per session", async () => {
    const res = await authed(`/api/v1/field-time/timesheets/?project_id=${FAKE_PROJECT_ID}&${WINDOW}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);

    const found = body.find((t: { id: string }) => t.id === timesheetId);
    expect(found).toBeTruthy();
    expect(found.project_id).toBe(FAKE_PROJECT_ID);
    expect(found.date).toBe("2026-01-15");
    expect(found.status).toBe("draft");
    expect(found.lines.length).toBe(1);

    const line = found.lines[0];
    expect(line.resource_id).toBe(crewId);
    expect(line.equipment_id).toBeNull();
    expect(line.kind).toBe("labour");
    expect(Number(line.hours)).toBeCloseTo(8, 4); // 08:00-16:30 minus a 30-minute break
    expect(line.break_minutes).toBe(30);
    expect(found.labour_hours).toBe(line.hours);
    expect(found.plant_hours).toBe("0.0000");
  });

  it("emulates the status filter against the fixed stub value -- anything else returns empty", async () => {
    const matching = await authed(`/api/v1/field-time/timesheets/?status=draft&${WINDOW}`);
    const matchingBody = await matching.json();
    expect(matchingBody.some((t: { id: string }) => t.id === timesheetId)).toBe(true);

    const nonMatching = await authed(`/api/v1/field-time/timesheets/?status=submitted&${WINDOW}`);
    const nonMatchingBody = await nonMatching.json();
    expect(nonMatchingBody).toEqual([]);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/field-time/timesheets/`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/field-time/timesheets/:id/", () => {
  it("fetches the same synthetic timesheet by its crewMemberId:date id, 404s for a malformed or nonexistent one", async () => {
    const res = await authed(`/api/v1/field-time/timesheets/${timesheetId}/`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(timesheetId);
    expect(body.lines.length).toBe(1);

    const malformed = await authed("/api/v1/field-time/timesheets/not-a-valid-id/");
    expect(malformed.status).toBe(404);

    const nonexistent = await authed("/api/v1/field-time/timesheets/00000000-0000-0000-0000-000000000000:2026-01-15/");
    expect(nonexistent.status).toBe(404);

    // Both segments present but the date half doesn't parse -- must 404
    // cleanly, not throw a RangeError from new Date(...).toISOString()
    // that the generic error handler would surface as an opaque 500.
    const unparsableDate = await authed(`/api/v1/field-time/timesheets/${crewId}:not-a-date/`);
    expect(unparsableDate.status).toBe(404);
  });
});

describe("GET /api/v1/field-time/timesheets/summary/", () => {
  it("counts synthetic timesheets by the fixed stub status", async () => {
    const res = await authed(`/api/v1/field-time/timesheets/summary/?project_id=${FAKE_PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.total).toBe("number");
    expect(body.total).toBeGreaterThanOrEqual(0);
    expect(typeof body.by_status.draft).toBe("number");
    expect(Number(body.labour_hours)).toBeGreaterThanOrEqual(0);
    expect(body.plant_hours).toBe("0.0000");
  });
});

describe("line CRUD, lifecycle, and offline capture (deliberately omitted)", () => {
  it("404s in isolation -- no domain backing for hand-editing a derived line or advancing a status this domain never gates", async () => {
    const addLine = await authed(`/api/v1/field-time/timesheets/${timesheetId}/lines/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hours: "1", cost_code: "X" }),
    });
    expect(addLine.status).toBe(404);

    const submit = await authed(`/api/v1/field-time/timesheets/${timesheetId}/submit/`, { method: "POST" });
    expect(submit.status).toBe(404);
  });
});
