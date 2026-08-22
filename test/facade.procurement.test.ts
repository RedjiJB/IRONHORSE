// Task #156, Slice E verification (procurement half): the procurement
// façade routes against a real running HTTP server and real Postgres --
// no mocking, same convention as every other test in this project.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { pool } from "../src/db/pool.js";
import { registerUser } from "../src/domain/users.js";
import { registerVendor } from "../src/domain/vendors.js";
import { buildFacadeServer } from "../src/facade/server.js";

let server: Server;
let baseUrl: string;
let accessToken: string;
const createdUserIds: string[] = [];
const createdUserDids: string[] = [];
const createdVendorIds: string[] = [];
const createdPurchaseOrderIds: string[] = [];

beforeAll(async () => {
  server = buildFacadeServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a bound TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const user = await registerUser({ email: "qa-facade-procurement@example.test", name: "QA Facade Procurement User", password: "correct-password-123", role: "staff" });
  createdUserIds.push(user.id);
  createdUserDids.push(user.did);

  const login = await fetch(`${baseUrl}/api/v1/users/auth/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "qa-facade-procurement@example.test", password: "correct-password-123" }),
  });
  ({ access_token: accessToken } = await login.json());
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query("DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)", [createdPurchaseOrderIds]);
  await pool.query("DELETE FROM purchase_orders WHERE id = ANY($1)", [createdPurchaseOrderIds]);
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

describe("POST /api/v1/procurement", () => {
  it("creates a freeform PO from ad-hoc line items, no backing order required", async () => {
    const vendor = await registerVendor({ name: "QA Facade Vendor" });
    createdVendorIds.push(vendor.id);

    const res = await authed("/api/v1/procurement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        project_id: "fake-project",
        vendor_contact_id: vendor.id,
        amount_total: "150.00",
        items: [{ description: "QA gravel delivery", quantity: "2" }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.vendor_warnings).toEqual([]);

    const poRow = await pool.query("SELECT id FROM purchase_orders WHERE vendor_id = $1", [vendor.id]);
    expect(poRow.rowCount).toBe(1);
    createdPurchaseOrderIds.push(poRow.rows[0].id);

    const itemRow = await pool.query("SELECT description, quantity FROM purchase_order_items WHERE purchase_order_id = $1", [poRow.rows[0].id]);
    expect(itemRow.rows[0].description).toBe("QA gravel delivery");
    expect(Number(itemRow.rows[0].quantity)).toBe(2);
  });

  it("422s with no items", async () => {
    const res = await authed("/api/v1/procurement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [] }),
    });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/v1/procurement", () => {
  it("lists POs mapped onto the frontend's status vocabulary (compiled -> draft)", async () => {
    const res = await authed("/api/v1/procurement?project_id=fake-project");
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.items.find((po: { id: string }) => po.id === createdPurchaseOrderIds[0]);
    expect(found).toBeTruthy();
    expect(found.status).toBe("draft");
    expect(found.line_items_count).toBe(1);
    expect(found.po_number).toMatch(/^PO-/);
  });
});

describe("GET /api/v1/procurement/:id", () => {
  it("returns full detail including line items", async () => {
    const res = await authed(`/api/v1/procurement/${createdPurchaseOrderIds[0]}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBe(1);
    expect(body.items[0].description).toBe("QA gravel delivery");
  });

  it("404s for a nonexistent PO", async () => {
    const res = await authed("/api/v1/procurement/00000000-0000-0000-0000-000000000000");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/v1/procurement/:id/issue", () => {
  it("moves status from compiled/draft to sent_to_office/issued", async () => {
    const res = await authed(`/api/v1/procurement/${createdPurchaseOrderIds[0]}/issue`, { method: "POST" });
    expect(res.status).toBe(200);

    const check = await pool.query("SELECT status FROM purchase_orders WHERE id = $1", [createdPurchaseOrderIds[0]]);
    expect(check.rows[0].status).toBe("sent_to_office");

    const listRes = await authed("/api/v1/procurement?project_id=fake-project");
    const listBody = await listRes.json();
    const found = listBody.items.find((po: { id: string }) => po.id === createdPurchaseOrderIds[0]);
    expect(found.status).toBe("issued");
  });
});

describe("POST /api/v1/procurement/:id/approve", () => {
  it("accepts the call but does not advance status -- no separate approved gate exists in this domain", async () => {
    const vendor = await registerVendor({ name: "QA Facade Vendor 2" });
    createdVendorIds.push(vendor.id);
    const create = await authed("/api/v1/procurement", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vendor_contact_id: vendor.id, items: [{ description: "QA item", quantity: "1" }] }),
    });
    await create.json();
    const poRow = await pool.query("SELECT id, status FROM purchase_orders WHERE vendor_id = $1", [vendor.id]);
    createdPurchaseOrderIds.push(poRow.rows[0].id);

    const res = await authed(`/api/v1/procurement/${poRow.rows[0].id}/approve`, { method: "POST" });
    expect(res.status).toBe(200);

    const after = await pool.query("SELECT status FROM purchase_orders WHERE id = $1", [poRow.rows[0].id]);
    expect(after.rows[0].status).toBe(poRow.rows[0].status); // unchanged
  });
});

describe("GET /api/v1/finance/dashboard", () => {
  it("returns a fixed currency stub -- not a real finance module", async () => {
    const res = await authed("/api/v1/finance/dashboard?project_id=fake-project");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ currency: "USD" });
  });
});
