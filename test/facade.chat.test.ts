// Chat façade route verification against a real running HTTP server --
// no mocking, same convention as every other test in this project. Only
// the "no provider configured" path is exercised here: no real
// DeepSeek/Anthropic key exists in this test environment (matching
// production today, see docs/ARCHITECTURE.md's chat status entry), so
// this is the actual current behavior, not a simulated failure case.
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

  const user = await registerUser({ email: "qa-facade-chat@example.test", name: "QA Facade Chat User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-chat@example.test", password: "correct-password-123" }),
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

describe("POST /api/v1/chat", () => {
  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" }),
    });
    expect(res.status).toBe(401);
  });

  it("422s for a missing or empty message", async () => {
    const missing = await authed("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    expect(missing.status).toBe(422);

    const empty = await authed("/api/v1/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "   " }) });
    expect(empty.status).toBe(422);
  });

  it("returns a clear 503 rather than a raw 500 when no LLM provider is configured", async () => {
    // This IS the current real state (no DEEPSEEK_API_KEY/ANTHROPIC_API_KEY
    // anywhere in this environment) -- see docs/ARCHITECTURE.md's chat
    // status entry. If a key is ever exported into this test's own
    // process env, this assertion is the one that will need to change.
    const res = await authed("/api/v1/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "How many crew members are active?" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.detail).toMatch(/no llm provider configured/i);
  });
});
