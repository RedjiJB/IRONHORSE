// Dashboard restoration, Slice J: GET /api/v1/system/status against a
// real running HTTP server and real Postgres -- no mocking, same
// convention as every other test in this project.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-system@example.test", name: "QA Facade System User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-system@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
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

function authed(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
  });
}

describe("GET /api/v1/system/status", () => {
  it("reports a connected API and database, and the AI provider list", async () => {
    const res = await authed("/api/v1/system/status");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.api.status).toBe("connected");
    expect(typeof body.api.version).toBe("string");
    expect(body.database.status).toBe("connected");
    expect(Array.isArray(body.ai.providers)).toBe(true);
    const names = body.ai.providers.map((p: { name: string }) => p.name);
    expect(names).toContain("deepseek");
    expect(names).toContain("anthropic");
    expect(typeof body.ai.configured).toBe("boolean");
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/system/status`);
    expect(res.status).toBe(401);
  });
});
