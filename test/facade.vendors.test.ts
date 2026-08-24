// Restoring Procurement's dead "Supplier Catalogs" chip as a real
// "Vendors" directory: GET /api/v1/vendors against a real running HTTP
// server and real Postgres -- no mocking, same convention as every
// other test in this project. Shared-database global list -- finds this
// test's own fixture by id, never asserts on list length.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerVendor } from "../src/domain/vendors.js";
import { createFreeformPurchaseOrder } from "../src/domain/purchaseOrders.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdVendorIds: string[] = [];
const createdPoIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-vendors@example.test", name: "QA Facade Vendors User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-vendors@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)", [createdPoIds]);
  await pool.query("DELETE FROM purchase_orders WHERE id = ANY($1)", [createdPoIds]);
  await pool.query("DELETE FROM vendors WHERE id = ANY($1)", [createdVendorIds]);
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

describe("GET /api/v1/vendors", () => {
  it("lists a registered vendor with real contact info and a zeroed spend when it has no POs", async () => {
    const vendor = await registerVendor({ name: "QA Facade Test Supplier", contactMethod: "email:qa@supplier.test", leadTimeDays: 5 });
    createdVendorIds.push(vendor.id);

    const res = await authed("/api/v1/vendors");
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.items.find((v: { id: string }) => v.id === vendor.id);
    expect(found).toBeTruthy();
    expect(found.name).toBe("QA Facade Test Supplier");
    expect(found.contact_method).toBe("email:qa@supplier.test");
    expect(found.lead_time_days).toBe(5);
    expect(found.po_count).toBe(0);
    expect(found.total_spend).toBe(0);
  });

  it("sums real purchase-order cost and count for a vendor with orders", async () => {
    const vendor = await registerVendor({ name: "QA Facade Spend Supplier" });
    createdVendorIds.push(vendor.id);

    const po1 = await createFreeformPurchaseOrder({ vendorId: vendor.id, cost: 100, items: [{ description: "QA vendor test item 1" }] });
    createdPoIds.push(po1.id);
    const po2 = await createFreeformPurchaseOrder({ vendorId: vendor.id, cost: 150, items: [{ description: "QA vendor test item 2" }] });
    createdPoIds.push(po2.id);

    const res = await authed("/api/v1/vendors");
    const body = await res.json();
    const found = body.items.find((v: { id: string }) => v.id === vendor.id);
    expect(found).toBeTruthy();
    expect(found.po_count).toBe(2);
    expect(found.total_spend).toBe(250);
  });

  it("401s without a bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/vendors`);
    expect(res.status).toBe(401);
  });
});
