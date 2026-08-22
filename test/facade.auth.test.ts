// Task #156, Slice A verification: the REST façade's auth routes
// (login/refresh/me) against a real running HTTP server and real
// Postgres -- no mocking, same convention as every domain test in this
// project. This is necessarily an integration test, not a domain-layer
// unit test, since the behavior under test (bearer-token extraction,
// JSON body parsing, HTTP status codes) only exists at the HTTP layer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [createdUserIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
  await pool.end();
});

async function registerTestUser(email: string, role?: "admin" | "staff" | "owner") {
  const user = await registerUser({ email, name: "QA Facade User", password: "correct-password-123", role });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);
  return user;
}

describe("POST /api/v1/users/auth/login/", () => {
  it("issues an access+refresh token pair for correct credentials", async () => {
    await registerTestUser("qa-facade-login@example.test");
    const res = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "qa-facade-login@example.test", password: "correct-password-123" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.access_token).toBe("string");
    expect(typeof body.refresh_token).toBe("string");
  });

  it("returns the same generic 401 for a wrong password, an unknown email, or a deactivated account", async () => {
    const user = await registerTestUser("qa-facade-wrongpass@example.test");

    const wrongPassword = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "qa-facade-wrongpass@example.test", password: "nope" }),
    });
    expect(wrongPassword.status).toBe(401);
    const wrongPasswordBody = await wrongPassword.json();

    const unknownEmail = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody-at-all@example.test", password: "whatever" }),
    });
    expect(unknownEmail.status).toBe(401);
    const unknownEmailBody = await unknownEmail.json();
    expect(unknownEmailBody.detail).toBe(wrongPasswordBody.detail); // no user-enumeration -- identical message either way

    await pool.query("UPDATE users SET active = false WHERE id = $1", [user.id]);
    const deactivated = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "qa-facade-wrongpass@example.test", password: "correct-password-123" }),
    });
    expect(deactivated.status).toBe(401);
  });
});

describe("GET /api/v1/users/me/", () => {
  it("returns role/email/full_name for a valid access token, and 401 for a garbage or missing one", async () => {
    await registerTestUser("qa-facade-me@example.test", "admin");
    const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "qa-facade-me@example.test", password: "correct-password-123" }),
    });
    const { access_token } = await login.json();

    const me = await fetch(`${baseUrl}/api/v1/users/me/`, { headers: { authorization: `Bearer ${access_token}` } });
    expect(me.status).toBe(200);
    const meBody = await me.json();
    expect(meBody).toEqual({ role: "admin", email: "qa-facade-me@example.test", full_name: "QA Facade User" });

    const garbage = await fetch(`${baseUrl}/api/v1/users/me/`, { headers: { authorization: "Bearer not-a-real-token" } });
    expect(garbage.status).toBe(401);

    const missing = await fetch(`${baseUrl}/api/v1/users/me/`);
    expect(missing.status).toBe(401);
  });
});

describe("POST /api/v1/users/auth/refresh/", () => {
  it("rotates the refresh token -- the old one stops working, the new one keeps working", async () => {
    await registerTestUser("qa-facade-refresh@example.test");
    const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "qa-facade-refresh@example.test", password: "correct-password-123" }),
    });
    const { refresh_token: firstRefresh } = await login.json();

    const refreshed = await fetch(`${baseUrl}/api/v1/users/auth/refresh/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: firstRefresh }),
    });
    expect(refreshed.status).toBe(200);
    const { access_token: newAccess, refresh_token: newRefresh } = await refreshed.json();
    expect(newRefresh).not.toBe(firstRefresh);

    // The rotated-away token must no longer work.
    const reuseOldToken = await fetch(`${baseUrl}/api/v1/users/auth/refresh/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: firstRefresh }),
    });
    expect(reuseOldToken.status).toBe(401);

    // The new access token is genuinely usable.
    const me = await fetch(`${baseUrl}/api/v1/users/me/`, { headers: { authorization: `Bearer ${newAccess}` } });
    expect(me.status).toBe(200);
  });

  it("rejects a crew (WhatsApp) session token -- only a dashboard-user session may authenticate the façade", async () => {
    const { registerCrewMember } = await import("../src/domain/crewMembers.js");
    const { createSession } = await import("../src/domain/sessions.js");
    const crew = await registerCrewMember({ name: "QA Facade Crew", phone: "+15559991201" });
    const { token } = await createSession({ crewMemberId: crew.id });

    const refreshed = await fetch(`${baseUrl}/api/v1/users/auth/refresh/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: token }),
    });
    expect(refreshed.status).toBe(401);

    await pool.query("DELETE FROM sessions WHERE crew_member_id = $1", [crew.id]);
    await pool.query("DELETE FROM capability_grants WHERE subject_did = $1", [crew.did]);
    await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = $1", [crew.did]);
    await pool.query("DELETE FROM keys WHERE did = $1", [crew.did]);
    await pool.query("DELETE FROM crew_members WHERE id = $1", [crew.id]);
  });
});

describe("capability revocation takes effect immediately, not after token expiry", () => {
  it("a demoted admin's very next request is denied by requireAdminRole, even with a still-valid access token", async () => {
    const admin = await registerTestUser("qa-facade-demote@example.test", "admin");
    const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "qa-facade-demote@example.test", password: "correct-password-123" }),
    });
    const { access_token } = await login.json();

    // Revoke the admin grant directly -- the access token itself is
    // untouched and still cryptographically valid.
    await pool.query("UPDATE capability_grants SET revoked_at = now() WHERE subject_did = $1 AND capability = 'dashboard:role:admin'", [admin.did]);

    const { requireAdminRole } = await import("../src/facade/auth.js");
    const fakeReq = { headers: { authorization: `Bearer ${access_token}` } } as unknown as import("node:http").IncomingMessage;
    await expect(requireAdminRole(fakeReq)).rejects.toThrow();
  });
});
