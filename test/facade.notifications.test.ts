// Task #156, Slice C verification: the notifications façade routes
// against a real running HTTP server and real Postgres -- no mocking,
// same convention as every other test in this project.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { raiseAlert } from "../src/domain/alerts.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdAlertIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-notifications@example.test", name: "QA Facade Notifications User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-notifications@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM notifications WHERE source_id = ANY($1)", [createdAlertIds]);
  await pool.query("DELETE FROM alerts WHERE id = ANY($1)", [createdAlertIds]);
  // read-all acknowledges every currently-unread notification system-wide
  // -- with a shared dev/test database, that can include other test
  // files' still-open alerts, leaving their notifications referencing
  // this test's own user via acknowledged_by_user_id. Detach those
  // (don't delete them -- they're not this test's rows to remove) before
  // deleting the user, or the FK blocks the delete.
  await pool.query("UPDATE notifications SET acknowledged_by_user_id = NULL WHERE acknowledged_by_user_id = ANY($1)", [createdUserIds]);
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

describe("GET /api/v1/notifications", () => {
  it("returns the Page<Notification> envelope plus unread_count, mapped onto the frontend's shape", async () => {
    const { alert } = await raiseAlert({ type: "idle", summary: "QA facade notification test" });
    createdAlertIds.push(alert.id);

    const res = await authed("/api/v1/notifications?limit=10&offset=0");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.total).toBe("number");
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
    expect(typeof body.unread_count).toBe("number");
    expect(body.unread_count).toBeGreaterThan(0);

    const found = body.items.find((n: { body_default: string }) => n.body_default === "QA facade notification test");
    expect(found).toBeTruthy();
    expect(found.notification_type).toBe("alert");
    expect(found.is_read).toBe(false);
    expect(found.icon_category).toBe("info"); // idle is a routine-severity alert
  });

  it("is_read filter maps onto acknowledged_at IS NULL / IS NOT NULL", async () => {
    const unread = await authed("/api/v1/notifications?is_read=false");
    const unreadBody = await unread.json();
    expect(unreadBody.items.every((n: { is_read: boolean }) => n.is_read === false)).toBe(true);

    const read = await authed("/api/v1/notifications?is_read=true");
    const readBody = await read.json();
    expect(readBody.items.every((n: { is_read: boolean }) => n.is_read === true)).toBe(true);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/notifications`);
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/notifications/unread-count", () => {
  // Separate endpoint the header bell polls independently of the list
  // page (found via real browser verification -- not in the originally
  // planned scope, the frontend's NotificationBell.tsx calls this on its
  // own 30s cadence regardless of whether /notifications is even open).
  //
  // Both this endpoint and the list envelope's unread_count query the
  // exact same count system-wide (no per-user scoping exists, same
  // limitation as v1) -- comparing two separately-fetched snapshots for
  // exact equality is racy against concurrently-running test files that
  // raise/acknowledge their own alerts in the same shared database.
  // Asserting a before/after delta around this test's own action proves
  // the endpoint responds to reality without depending on nothing else
  // touching the global count in between.
  it("count increases by at least 1 after raising a new alert", async () => {
    const before = await (await authed("/api/v1/notifications/unread-count")).json();

    const { alert } = await raiseAlert({ type: "idle", summary: "QA facade unread-count test" });
    createdAlertIds.push(alert.id);

    const after = await (await authed("/api/v1/notifications/unread-count")).json();
    expect(after.count).toBeGreaterThanOrEqual(before.count + 1);
  });
});

describe("POST /api/v1/notifications/:id/read", () => {
  it("acknowledges a notification, attributed to the dashboard user", async () => {
    const { alert } = await raiseAlert({ type: "idle", summary: "QA facade single-read test" });
    createdAlertIds.push(alert.id);
    const row = await pool.query("SELECT id FROM notifications WHERE source_id = $1", [alert.id]);
    const notificationId = row.rows[0].id as string;

    const res = await authed(`/api/v1/notifications/${notificationId}/read`, { method: "POST" });
    expect(res.status).toBe(200);

    const check = await pool.query("SELECT acknowledged_at, acknowledged_by_user_id FROM notifications WHERE id = $1", [notificationId]);
    expect(check.rows[0].acknowledged_at).toBeTruthy();
    expect(check.rows[0].acknowledged_by_user_id).toBe(createdUserIds[0]);
  });

  it("404s for a nonexistent notification", async () => {
    const res = await authed("/api/v1/notifications/00000000-0000-0000-0000-000000000000/read", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/notifications/read-all", () => {
  // read-all acknowledges every currently-unread notification system-wide
  // -- with a shared dev/test database, that can include other test
  // files' still-open alerts too. Assert only against this test's own
  // fixtures, not a global unread_count of zero, so this stays safe
  // alongside concurrently-running test files.
  it("acknowledges every currently-unread notification, including this test's own", async () => {
    const first = await raiseAlert({ type: "idle", summary: "QA facade read-all test 1" });
    const second = await raiseAlert({ type: "idle", summary: "QA facade read-all test 2" });
    createdAlertIds.push(first.alert.id, second.alert.id);

    const res = await authed("/api/v1/notifications/read-all", { method: "POST" });
    expect(res.status).toBe(200);

    const check = await pool.query(
      "SELECT acknowledged_at FROM notifications WHERE source_id = ANY($1)",
      [[first.alert.id, second.alert.id]],
    );
    expect(check.rows.every((r) => r.acknowledged_at !== null)).toBe(true);
  });
});
