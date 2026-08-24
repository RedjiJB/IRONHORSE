// Restoring Settings, Slice Q: GET/PATCH /api/v1/settings/llm and
// POST /api/v1/users/me/change-password against a real running HTTP
// server and real Postgres -- no mocking, same convention as every
// other test in this project. The llm_settings table is a true
// singleton shared across the whole suite -- this file restores
// whatever it found there in its own afterAll, rather than deleting
// rows, so it never leaves the singleton in a state another test
// (or this file's own next run) doesn't expect.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { getLlmSettings } from "../src/domain/llmSettings.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let adminToken: string;
let staffToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
let originalLlmSettings: { deepseek_api_key: string | null; anthropic_api_key: string | null };

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  originalLlmSettings = await getLlmSettings();

  const admin = await registerUser({ email: "qa-facade-settings-admin@example.test", name: "QA Facade Settings Admin", password: "correct-password-123", role: "admin" });
  createdUserIds.push(admin.id);
  createdUserDids.push(admin.did);
  const adminLogin = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-settings-admin@example.test", password: "correct-password-123" }),
  });
  ({ access_token: adminToken } = await adminLogin.json());

  const staff = await registerUser({ email: "qa-facade-settings-staff@example.test", name: "QA Facade Settings Staff", password: "correct-password-123", role: "staff" });
  createdUserIds.push(staff.id);
  createdUserDids.push(staff.did);
  const staffLogin = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-settings-staff@example.test", password: "correct-password-123" }),
  });
  ({ access_token: staffToken } = await staffLogin.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("UPDATE llm_settings SET deepseek_api_key = $1, anthropic_api_key = $2", [originalLlmSettings.deepseek_api_key, originalLlmSettings.anthropic_api_key]);
  await pool.query("DELETE FROM sessions WHERE user_id = ANY($1)", [createdUserIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdUserDids]);
  await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
  await pool.end();
});

function authedAs(token: string) {
  return (path: string, init?: RequestInit) =>
    fetch(`${baseUrl}${path}`, { ...init, headers: { ...init?.headers, authorization: `Bearer ${token}` } });
}

describe("GET/PATCH /api/v1/settings/llm", () => {
  it("sets a key via PATCH, reports it configured via GET, and never echoes the raw value", async () => {
    const asAdmin = authedAs(adminToken);
    const patch = await asAdmin("/api/v1/settings/llm", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deepseek_api_key: "qa-test-deepseek-key" }),
    });
    expect(patch.status).toBe(200);
    const patchBody = await patch.json();
    expect(patchBody.deepseek_configured).toBe(true);
    expect(patchBody.deepseek_api_key).toBeUndefined();

    const get = await asAdmin("/api/v1/settings/llm");
    const getBody = await get.json();
    expect(getBody.deepseek_configured).toBe(true);

    const stored = await getLlmSettings();
    expect(stored.deepseek_api_key).toBe("qa-test-deepseek-key");
  });

  it("clears a key when patched with an empty string", async () => {
    const asAdmin = authedAs(adminToken);
    await asAdmin("/api/v1/settings/llm", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anthropic_api_key: "qa-temp-key" }),
    });
    const clear = await asAdmin("/api/v1/settings/llm", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ anthropic_api_key: "" }),
    });
    expect((await clear.json()).anthropic_configured).toBe(false);
  });

  it("403s for a non-admin staff user", async () => {
    const res = await authedAs(staffToken)("/api/v1/settings/llm");
    expect(res.status).toBe(403);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/settings/llm`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/users/me/change-password", () => {
  it("changes the password when the current password is correct, and the new one then logs in", async () => {
    const res = await authedAs(staffToken)("/api/v1/users/me/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current_password: "correct-password-123", new_password: "new-correct-password-456" }),
    });
    expect(res.status).toBe(200);

    const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "qa-facade-settings-staff@example.test", password: "new-correct-password-456" }),
    });
    expect(login.status).toBe(200);
  });

  it("401s with the wrong current password", async () => {
    const res = await authedAs(adminToken)("/api/v1/users/me/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current_password: "totally-wrong-password", new_password: "whatever-new-password" }),
    });
    expect(res.status).toBe(401);
  });

  it("422s for a new password under 8 characters", async () => {
    const res = await authedAs(adminToken)("/api/v1/users/me/change-password", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ current_password: "correct-password-123", new_password: "short" }),
    });
    expect(res.status).toBe(422);
  });
});
