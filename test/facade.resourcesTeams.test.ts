// Task #156, Slice G verification: the resources + teams façade routes
// against a real running HTTP server and real Postgres -- no mocking,
// same convention as every other test in this project.
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

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-resources-teams@example.test", name: "QA Facade Resources Teams User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-resources-teams@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

describe("GET /api/v1/resources/resources/", () => {
  it("lists crew members mapped onto the Resource shape, resource_type always 'person'", async () => {
    const crew = await registerCrewMember({ name: "QA Resource Crew", phone: "+15559991401" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const res = await authed("/api/v1/resources/resources/?limit=200&offset=0");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.limit).toBe(200);
    expect(body.offset).toBe(0);
    expect(typeof body.total).toBe("number");

    const found = body.items.find((r: { code: string }) => r.code === "+15559991401");
    expect(found).toBeTruthy();
    expect(found.name).toBe("QA Resource Crew");
    expect(found.resource_type).toBe("person");
    expect(found.status).toBe("active");
    expect(found.currency).toBe("USD");
  });

  it("emulates the type filter against the fixed stub value -- anything else returns empty", async () => {
    const matching = await authed("/api/v1/resources/resources/?type=person");
    const matchingBody = await matching.json();
    expect(matchingBody.total).toBeGreaterThan(0);

    const nonMatching = await authed("/api/v1/resources/resources/?type=equipment");
    const nonMatchingBody = await nonMatching.json();
    expect(nonMatchingBody.total).toBe(0);
    expect(nonMatchingBody.items).toEqual([]);
  });

  it("status filter maps onto crew_members.active", async () => {
    const res = await authed("/api/v1/resources/resources/?status=inactive");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.every((r: { status: string }) => r.status === "inactive")).toBe(true);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/resources/resources/`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/resources/resources/:id", () => {
  it("fetches a single resource, 404s for a nonexistent one", async () => {
    const crew = await registerCrewMember({ name: "QA Resource Crew Single", phone: "+15559991402" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const res = await authed(`/api/v1/resources/resources/${crew.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe("+15559991402");

    const missing = await authed("/api/v1/resources/resources/00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/v1/teams/project/:projectId", () => {
  it("returns exactly one synthetic 'All Crew' team containing every crew member", async () => {
    const crew = await registerCrewMember({ name: "QA Team Crew", phone: "+15559991403" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const res = await authed(`/api/v1/teams/project/${FAKE_PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe("all-crew");
    expect(body[0].project_id).toBe(FAKE_PROJECT_ID);
    expect(body[0].is_default).toBe(true);

    const found = body[0].memberships.find((m: { full_name: string }) => m.full_name === "QA Team Crew");
    expect(found).toBeTruthy();
    expect(found.user_id).toBe(crew.id);
    expect(found.is_active).toBe(true);
    expect(body[0].member_count).toBe(body[0].memberships.length);
  });
});

describe("GET /api/v1/teams/:teamId/members", () => {
  it("lists the same membership set for the synthetic team id, 404s for any other", async () => {
    const crew = await registerCrewMember({ name: "QA Team Member Crew", phone: "+15559991404" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const res = await authed("/api/v1/teams/all-crew/members");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.some((m: { user_id: string }) => m.user_id === crew.id)).toBe(true);

    const missing = await authed("/api/v1/teams/some-other-team/members");
    expect(missing.status).toBe(404);
  });
});
