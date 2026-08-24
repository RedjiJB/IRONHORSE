// Dashboard restoration, Slice K: GET /api/v1/activity against a real
// running HTTP server and real Postgres -- no mocking, same convention
// as every other test in this project. This route reads across five
// domains at once (alerts, notifications, purchase orders, documents,
// timeclock), so assertions find each of this test's own fixtures by id
// within the returned list -- shared-database, same lesson as
// locations/payroll/notifications before it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { raiseAlert, resolveAlert } from "../src/domain/alerts.js";
import { listNotifications, acknowledgeNotification } from "../src/domain/notifications.js";
import { createFreeformPurchaseOrder } from "../src/domain/purchaseOrders.js";
import { registerDocument } from "../src/domain/documents.js";
import { createTimeclockEntry } from "../src/domain/timeclock.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdAlertIds: string[] = [];
const createdPoIds: string[] = [];
const createdDocumentIds: string[] = [];
const createdTimeclockEntryIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-activity@example.test", name: "QA Facade Activity User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-activity@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM timeclock_entries WHERE id = ANY($1)", [createdTimeclockEntryIds]);
  await pool.query("DELETE FROM documents WHERE id = ANY($1)", [createdDocumentIds]);
  await pool.query("DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)", [createdPoIds]);
  await pool.query("DELETE FROM purchase_orders WHERE id = ANY($1)", [createdPoIds]);
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

describe("GET /api/v1/activity", () => {
  it("merges alert, notification, purchase order, document, and timeclock events into one timestamp-sorted feed", async () => {
    const crew = await registerCrewMember({ name: "QA Activity Crew", phone: "+15559991901" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const { alert } = await raiseAlert({ type: "idle", summary: "QA test alert", relatedRecordId: crew.id });
    createdAlertIds.push(alert.id);
    const resolveResult = await resolveAlert(alert.id, { crewMemberId: crew.id });
    expect(resolveResult.ok).toBe(true);

    const { items: notifications } = await listNotifications({ limit: 10, offset: 0 });
    const notification = notifications.find((n) => n.source_id === alert.id);
    expect(notification).toBeTruthy();
    const ackResult = await acknowledgeNotification(notification!.id, { crewMemberId: crew.id });
    expect(ackResult.ok).toBe(true);

    const po = await createFreeformPurchaseOrder({ items: [{ description: "QA test item", quantity: 1 }] });
    createdPoIds.push(po.id);
    await pool.query("UPDATE purchase_orders SET fulfilled_at = now(), fulfilled_by = $2 WHERE id = $1", [po.id, crew.id]);

    const doc = await registerDocument({ type: "receipt", filename: "qa-receipt.pdf", uploadedBy: crew.id });
    createdDocumentIds.push(doc.id);

    const clockIn = await createTimeclockEntry({ crewMemberId: crew.id, eventType: "in", geofenceVerified: false });
    createdTimeclockEntryIds.push(clockIn.id);
    const clockOut = await createTimeclockEntry({ crewMemberId: crew.id, eventType: "out", geofenceVerified: false });
    createdTimeclockEntryIds.push(clockOut.id);

    const res = await authed("/api/v1/activity?limit=200");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);

    const types = new Set(body.items.map((e: { type: string }) => e.type));
    expect(types.has("alert_raised")).toBe(true);
    expect(types.has("alert_resolved")).toBe(true);
    expect(types.has("notification_raised")).toBe(true);
    expect(types.has("notification_acknowledged")).toBe(true);
    expect(types.has("purchase_order_created")).toBe(true);
    expect(types.has("purchase_order_fulfilled")).toBe(true);
    expect(types.has("document_uploaded")).toBe(true);
    expect(types.has("timeclock_in")).toBe(true);
    expect(types.has("timeclock_out")).toBe(true);

    const resolvedEntry = body.items.find((e: { id: string }) => e.id === `alert:${alert.id}:resolved`);
    expect(resolvedEntry.actor_name).toBe("QA Activity Crew");

    // Real, honest destination links: "idle" alerts/notifications link to
    // the crew page, POs to procurement, timeclock to field-time -- and
    // a document upload has no real page to link to at all, so null.
    const raisedEntry = body.items.find((e: { id: string }) => e.id === `alert:${alert.id}:raised`);
    expect(raisedEntry.action_url).toBe("/resources");
    expect(resolvedEntry.action_url).toBe("/resources");
    const notifRaised = body.items.find((e: { id: string }) => e.id === `notification:${notification!.id}:raised`);
    expect(notifRaised.action_url).toBe("/resources");
    const poCreated = body.items.find((e: { id: string }) => e.id === `po:${po.id}:created`);
    expect(poCreated.action_url).toBe("/procurement");
    const poFulfilled = body.items.find((e: { id: string }) => e.id === `po:${po.id}:fulfilled`);
    expect(poFulfilled.action_url).toBe("/procurement");
    const docEntry = body.items.find((e: { id: string }) => e.id === `document:${doc.id}`);
    expect(docEntry.action_url).toBeNull();
    const timeclockInEntry = body.items.find((e: { type: string; actor_name: string | null }) => e.type === "timeclock_in" && e.actor_name === "QA Activity Crew");
    expect(timeclockInEntry?.action_url).toBe("/field-time");

    const timestamps = body.items.map((e: { timestamp: string }) => e.timestamp);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/activity`);
    expect(res.status).toBe(401);
  });
});
