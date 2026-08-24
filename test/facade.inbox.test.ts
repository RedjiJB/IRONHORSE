// Dashboard restoration, Slice L: GET/POST /api/v1/dashboard/inbox
// against a real running HTTP server and real Postgres -- no mocking,
// same convention as every other test in this project. Shared-database
// global lists (open alerts, pending notifications) -- assertions find
// this test's own fixtures by id, never assert on list length.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { raiseAlert } from "../src/domain/alerts.js";
import { listNotifications } from "../src/domain/notifications.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdAlertIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-inbox@example.test", name: "QA Facade Inbox User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-inbox@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
    headers: { ...init?.headers, authorization: `Bearer ${accessToken}` },
  });
}

describe("GET /api/v1/dashboard/inbox", () => {
  it("lists an open alert and its notification, both unresolved", async () => {
    const crew = await registerCrewMember({ name: "QA Inbox Crew", phone: "+15559991801" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const { alert } = await raiseAlert({ type: "overdue", summary: "QA inbox test alert", relatedRecordId: crew.id });
    createdAlertIds.push(alert.id);

    const res = await authed("/api/v1/dashboard/inbox?limit=200");
    expect(res.status).toBe(200);
    const body = await res.json();

    const alertItem = body.items.find((i: { id: string }) => i.id === `alert:${alert.id}`);
    expect(alertItem).toBeTruthy();
    expect(alertItem.source).toBe("alert");
    expect(alertItem.severity).toBe("critical");
    // "overdue" has no real façade page to link to (checkouts.id has no
    // route) -- null, not a guessed destination.
    expect(alertItem.action_url).toBeNull();

    const { items: notifications } = await listNotifications({ limit: 200, offset: 0 });
    const notif = notifications.find((n) => n.source_id === alert.id);
    expect(notif).toBeTruthy();
    const notifItem = body.items.find((i: { id: string }) => i.id === `notification:${notif!.id}`);
    expect(notifItem).toBeTruthy();
    expect(notifItem.source).toBe("notification");
    expect(notifItem.action_url).toBeNull();
  });

  it("links an alert type backed by a real façade page (crew-related types → /resources)", async () => {
    const crew = await registerCrewMember({ name: "QA Inbox Linked Crew", phone: "+15559991803" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const { alert } = await raiseAlert({ type: "idle", summary: "QA inbox linked test alert", relatedRecordId: crew.id });
    createdAlertIds.push(alert.id);

    const res = await authed("/api/v1/dashboard/inbox?limit=200");
    const body = await res.json();
    const alertItem = body.items.find((i: { id: string }) => i.id === `alert:${alert.id}`);
    expect(alertItem.action_url).toBe("/resources");

    const { items: notifications } = await listNotifications({ limit: 200, offset: 0 });
    const notif = notifications.find((n) => n.source_id === alert.id);
    const notifItem = body.items.find((i: { id: string }) => i.id === `notification:${notif!.id}`);
    expect(notifItem.action_url).toBe("/resources");
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/dashboard/inbox`);
    expect(res.status).toBe(401);
  });
});

describe("POST /api/v1/dashboard/inbox/:id/acknowledge", () => {
  it("resolves an alert and removes it from the open list", async () => {
    const crew = await registerCrewMember({ name: "QA Inbox Ack Crew", phone: "+15559991802" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const { alert } = await raiseAlert({ type: "idle", summary: "QA inbox ack test alert", relatedRecordId: crew.id });
    createdAlertIds.push(alert.id);

    const ack = await authed(`/api/v1/dashboard/inbox/alert:${alert.id}/acknowledge`, { method: "POST" });
    expect(ack.status).toBe(200);

    const res = await authed("/api/v1/dashboard/inbox?limit=200");
    const body = await res.json();
    const found = body.items.find((i: { id: string }) => i.id === `alert:${alert.id}`);
    expect(found).toBeUndefined();
  });

  it("404s for an unknown item id", async () => {
    const res = await authed("/api/v1/dashboard/inbox/alert:00000000-0000-0000-0000-000000000000/acknowledge", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
