// Restoring Notification Webhooks: GET/POST/PATCH/DELETE
// /api/v1/notifications/webhooks/ against a real running HTTP server and
// real Postgres -- no mocking, same convention as every other test in
// this project. Also exercises the real dispatcher (raiseAlert →
// createNotificationForAlert → dispatchToWebhooks) against a throwaway
// local HTTP listener standing in for the "any system you run" target,
// confirming a real signed POST actually arrives, not just that a row
// gets written.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server, type IncomingMessage } from "node:http";
import { createHmac } from "node:crypto";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { raiseAlert } from "../src/domain/alerts.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let adminToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdAlertIds: string[] = [];
const createdWebhookIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const admin = await registerUser({ email: "qa-facade-webhooks@example.test", name: "QA Facade Webhooks Admin", password: "correct-password-123", role: "admin" });
  createdUserIds.push(admin.id);
  createdUserDids.push(admin.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-webhooks@example.test", password: "correct-password-123" }),
  });
  ({ access_token: adminToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM webhook_targets WHERE id = ANY($1)", [createdWebhookIds]);
  await pool.query("DELETE FROM notifications WHERE source_id = ANY($1)", [createdAlertIds]);
  await pool.query("DELETE FROM alerts WHERE id = ANY($1)", [createdAlertIds]);
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
    headers: { ...init?.headers, authorization: `Bearer ${adminToken}` },
  });
}

describe("GET/POST/PATCH/DELETE /api/v1/notifications/webhooks/", () => {
  it("creates a webhook target and never exposes the raw secret back", async () => {
    const res = await authed("/api/v1/notifications/webhooks/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Test Webhook", url: "https://example.test/hook", secret: "shh-its-a-secret" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    createdWebhookIds.push(body.id);
    expect(body.has_secret).toBe(true);
    expect(body.secret).toBeUndefined();

    const list = await authed("/api/v1/notifications/webhooks/");
    const items = await list.json();
    expect(Array.isArray(items)).toBe(true);
    expect(items.find((t: { id: string }) => t.id === body.id)).toBeTruthy();
  });

  it("toggles active via PATCH and deletes via DELETE", async () => {
    const create = await authed("/api/v1/notifications/webhooks/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Toggle Webhook", url: "https://example.test/hook2" }),
    });
    const target = await create.json();
    createdWebhookIds.push(target.id);
    expect(target.active).toBe(true);

    const patch = await authed(`/api/v1/notifications/webhooks/${target.id}/`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    expect(patch.status).toBe(200);
    expect((await patch.json()).active).toBe(false);

    const del = await authed(`/api/v1/notifications/webhooks/${target.id}/`, { method: "DELETE" });
    expect(del.status).toBe(200);

    const list = await authed("/api/v1/notifications/webhooks/");
    const items = await list.json();
    expect(items.find((t: { id: string }) => t.id === target.id)).toBeUndefined();
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/notifications/webhooks/`);
    expect(res.status).toBe(401);
  });
});

describe("real webhook delivery", () => {
  it("fires a signed POST to an active target when a notification is created", async () => {
    const received: { body: string; signature: string | null }[] = [];
    const receiver = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        received.push({ body: Buffer.concat(chunks).toString("utf8"), signature: (req.headers["x-webhook-signature"] as string) ?? null });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, resolve));
    const receiverAddress = receiver.address();
    if (!receiverAddress || typeof receiverAddress === "string") throw new Error("expected a bound TCP port");
    const receiverUrl = `http://127.0.0.1:${receiverAddress.port}/`;

    const secret = "qa-webhook-secret";
    const create = await authed("/api/v1/notifications/webhooks/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "QA Delivery Webhook", url: receiverUrl, secret }),
    });
    const target = await create.json();
    createdWebhookIds.push(target.id);

    const crew = await registerCrewMember({ name: "QA Webhook Crew", phone: "+15559990010" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);
    const { alert } = await raiseAlert({ type: "idle", summary: "QA webhook delivery test", relatedRecordId: crew.id });
    createdAlertIds.push(alert.id);

    // dispatchToWebhooks is fire-and-forget from raiseAlert's perspective;
    // give it a moment to actually land. The target is active + '*'-
    // filtered, so it also receives deliveries for any OTHER alert
    // raised by concurrently-running test files against this same
    // shared database in the meantime -- find this test's own delivery
    // by content, don't assume it's the first (or only) one received.
    await new Promise((r) => setTimeout(r, 500));
    await new Promise<void>((resolve) => receiver.close(() => resolve()));

    expect(received.length).toBeGreaterThan(0);
    const delivered = received.find((r) => JSON.parse(r.body).data.message === "QA webhook delivery test");
    expect(delivered).toBeTruthy();
    const parsed = JSON.parse(delivered!.body);
    expect(parsed.event).toBe("notification.created");
    expect(parsed.data.message).toBe("QA webhook delivery test");

    const expectedSignature = createHmac("sha256", secret).update(delivered!.body).digest("hex");
    expect(delivered!.signature).toBe(expectedSignature);

    const list = await authed("/api/v1/notifications/webhooks/");
    const items = await list.json();
    const updated = items.find((t: { id: string }) => t.id === target.id);
    expect(updated.last_status).toBe(200);
    expect(updated.failure_count).toBe(0);
  });
});
