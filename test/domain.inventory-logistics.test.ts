// Phase 2 slice 3 verification: the inventory/logistics domain --
// vendors, assets, consumables, loadouts, checkouts, orders, transfers,
// purchase orders -- re-expressed from v1's fieldops-system as the
// requirements baseline (not copied code). Focuses on the load-bearing
// business rules identified from that requirements research: the
// unconfirmed->available gate, double-checkout prevention, forward-only
// status enums, the stocked/per_job_delivery consumable split, and the
// four confirm-before-execute action types this slice adds
// (asset_verification, consumable_adjustment, checkout_return,
// purchase_order_fulfillment).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { registerSite } from "../src/domain/sites.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { registerVendor } from "../src/domain/vendors.js";
import {
  getAsset,
  registerAsset,
  registerAssetVerificationExecutor,
  setAssetStatus,
} from "../src/domain/assets.js";
import {
  getConsumable,
  getConsumablePriceHistory,
  registerConsumable,
  registerConsumableAdjustmentExecutor,
} from "../src/domain/consumables.js";
import { addLoadoutItem, createLoadout, resolveLoadout } from "../src/domain/loadouts.js";
import { createCheckout, listOverdueCheckouts, registerCheckoutReturnExecutor } from "../src/domain/checkouts.js";
import { addOrderItem, advanceOrderStatus, createOrder, setOrderItemUnitCost } from "../src/domain/orders.js";
import { advanceTransferStatus, createTransfer } from "../src/domain/transfers.js";
import {
  compilePurchaseOrder,
  registerPurchaseOrderFulfillmentExecutor,
  sendPurchaseOrder,
} from "../src/domain/purchaseOrders.js";
import { approveConfirmation, submitForConfirmation } from "../src/domain/confirmations.js";

registerAssetVerificationExecutor();
registerConsumableAdjustmentExecutor();
registerCheckoutReturnExecutor();
registerPurchaseOrderFulfillmentExecutor();

let siteA: string;
let siteB: string;
let crewId: string;
let managerId: string;
const createdSiteIds: string[] = [];
const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdVendorIds: string[] = [];
const createdAssetIds: string[] = [];
const createdConsumableIds: string[] = [];
const createdLoadoutIds: string[] = [];
const createdCheckoutIds: string[] = [];
const createdOrderIds: string[] = [];
const createdTransferIds: string[] = [];
const createdPurchaseOrderIds: string[] = [];

beforeAll(async () => {
  const a = await registerSite({ name: "QA Inventory Site A", type: "job_site" });
  siteA = a.id;
  createdSiteIds.push(a.id);
  const b = await registerSite({ name: "QA Inventory Site B", type: "job_site" });
  siteB = b.id;
  createdSiteIds.push(b.id);

  const crew = await registerCrewMember({ name: "QA Inventory Crew", phone: "+15559990801" });
  crewId = crew.id;
  createdCrewIds.push(crew.id);
  createdCrewDids.push(crew.did);

  const manager = await registerCrewMember({ name: "QA Inventory Manager", phone: "+15559990802", role: "management" });
  managerId = manager.id;
  createdCrewIds.push(manager.id);
  createdCrewDids.push(manager.did);
});

afterAll(async () => {
  await pool.query("DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)", [createdPurchaseOrderIds]);
  await pool.query("DELETE FROM purchase_orders WHERE id = ANY($1)", [createdPurchaseOrderIds]);
  await pool.query("DELETE FROM transfers WHERE id = ANY($1)", [createdTransferIds]);
  await pool.query("DELETE FROM order_items WHERE order_id = ANY($1)", [createdOrderIds]);
  await pool.query("DELETE FROM orders WHERE id = ANY($1)", [createdOrderIds]);
  await pool.query("DELETE FROM checkouts WHERE id = ANY($1)", [createdCheckoutIds]);
  await pool.query("DELETE FROM loadout_items WHERE loadout_id = ANY($1)", [createdLoadoutIds]);
  await pool.query("DELETE FROM loadouts WHERE id = ANY($1)", [createdLoadoutIds]);
  await pool.query("DELETE FROM consumables WHERE id = ANY($1)", [createdConsumableIds]);
  await pool.query("DELETE FROM assets WHERE id = ANY($1)", [createdAssetIds]);
  await pool.query("DELETE FROM vendors WHERE id = ANY($1)", [createdVendorIds]);
  await pool.query("DELETE FROM pending_confirmations WHERE submitted_by = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
  await pool.end();
});

describe("vendors", () => {
  it("registers a vendor", async () => {
    const vendor = await registerVendor({ name: "QA Test Vendor", leadTimeDays: 3 });
    createdVendorIds.push(vendor.id);
    expect(vendor.name).toBe("QA Test Vendor");
    expect(vendor.lead_time_days).toBe(3);
  });
});

describe("assets", () => {
  it("always starts unconfirmed, never assignable until verified", async () => {
    const asset = await registerAsset({ name: "QA Test Compactor", category: "equipment", currentSiteId: siteA });
    createdAssetIds.push(asset.id);
    expect(asset.status).toBe("unconfirmed");
    expect(asset.last_verified_at).toBeNull();
  });

  it("set_asset_status rejects 'available' -- that's only reachable through verification", async () => {
    const asset = await registerAsset({ name: "QA Test Saw", currentSiteId: siteA });
    createdAssetIds.push(asset.id);
    // @ts-expect-error -- deliberately passing a status outside the directly-settable set
    const result = await setAssetStatus(asset.id, "available");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("status_not_directly_settable");
  });

  it("submit_asset_verification, once approved, moves unconfirmed -> available and records the submitter as verified_by", async () => {
    const asset = await registerAsset({ name: "QA Test Trailer", currentSiteId: siteA });
    createdAssetIds.push(asset.id);

    const pending = await submitForConfirmation({
      actionType: "asset_verification",
      capability: "mcp:tool:submit_asset_verification",
      summary: "verify trailer",
      payload: { assetId: asset.id, crewMemberId: crewId },
      submittedByCrewMemberId: crewId,
    });
    const result = await approveConfirmation(pending.id, managerId);
    expect(result.ok).toBe(true);

    const verified = await getAsset(asset.id);
    expect(verified?.status).toBe("available");
    expect(verified?.last_verified_at).toBeTruthy();
    expect(verified?.verified_by).toBe(crewId);
  });
});

describe("consumables", () => {
  it("'stocked' starts at quantity 0; 'per_job_delivery' never tracks quantity at all", async () => {
    const stocked = await registerConsumable({ name: "QA Poly Sand", unit: "bag", stockingType: "stocked", reorderThreshold: 10 });
    createdConsumableIds.push(stocked.id);
    expect(Number(stocked.quantity_on_hand)).toBe(0);

    const perJob = await registerConsumable({ name: "QA Sod", unit: "sqft", stockingType: "per_job_delivery" });
    createdConsumableIds.push(perJob.id);
    expect(perJob.quantity_on_hand).toBeNull();
  });

  it("submit_consumable_adjustment, once approved, applies the signed delta -- not trusted from the crew member's own report alone", async () => {
    const consumable = await registerConsumable({ name: "QA Stone Dust", unit: "bag", stockingType: "stocked" });
    createdConsumableIds.push(consumable.id);

    const pending = await submitForConfirmation({
      actionType: "consumable_adjustment",
      capability: "mcp:tool:submit_consumable_adjustment",
      summary: "restock",
      payload: { consumableId: consumable.id, delta: 25 },
      submittedByCrewMemberId: crewId,
    });
    const result = await approveConfirmation(pending.id, managerId);
    expect(result.ok).toBe(true);

    const updated = await getConsumable(consumable.id);
    expect(Number(updated?.quantity_on_hand)).toBe(25);
  });

  it("adjustment fails at approval time for a 'per_job_delivery' consumable -- it has no quantity concept", async () => {
    const perJob = await registerConsumable({ name: "QA Topsoil", unit: "cubic_yard", stockingType: "per_job_delivery" });
    createdConsumableIds.push(perJob.id);

    const pending = await submitForConfirmation({
      actionType: "consumable_adjustment",
      capability: "mcp:tool:submit_consumable_adjustment",
      summary: "bad adjustment",
      payload: { consumableId: perJob.id, delta: 5 },
      submittedByCrewMemberId: crewId,
    });
    // The executor throws (not a typed {ok:false} result) -- approveConfirmation
    // has no try/catch around the executor call, so this propagates.
    await expect(approveConfirmation(pending.id, managerId)).rejects.toThrow(/not_stocked/);
  });

  it("price history reflects real order_items.unit_cost, not a static catalog field", async () => {
    const consumable = await registerConsumable({ name: "QA Riverstone", unit: "ton", stockingType: "per_job_delivery" });
    createdConsumableIds.push(consumable.id);
    const order = await createOrder({ requesterId: crewId, siteId: siteA });
    createdOrderIds.push(order.id);
    const item = await addOrderItem({ orderId: order.id, consumableId: consumable.id, quantity: 4 });
    await setOrderItemUnitCost(item.id, 87.5);

    const history = await getConsumablePriceHistory(consumable.id);
    expect(history.length).toBe(1);
    expect(Number(history[0].unit_cost)).toBe(87.5);
  });
});

describe("loadouts", () => {
  it("rejects a loadout item with neither or both of asset/consumable set", async () => {
    const loadout = await createLoadout({ name: "QA Test Kit" });
    createdLoadoutIds.push(loadout.id);
    await expect(addLoadoutItem({ loadoutId: loadout.id, quantity: 1 })).rejects.toThrow();
  });

  it("scales_with_crew items multiply by crew size only when resolved, base quantity stays flat in storage", async () => {
    const asset = await registerAsset({ name: "QA Test Shovel Template Asset" });
    createdAssetIds.push(asset.id);
    const consumable = await registerConsumable({ name: "QA Chip Stone", unit: "cubic_yard", stockingType: "per_job_delivery" });
    createdConsumableIds.push(consumable.id);

    const loadout = await createLoadout({ name: "QA Scaling Kit" });
    createdLoadoutIds.push(loadout.id);
    const scaling = await addLoadoutItem({ loadoutId: loadout.id, assetId: asset.id, quantity: 1, scalesWithCrew: true });
    const flat = await addLoadoutItem({ loadoutId: loadout.id, consumableId: consumable.id, quantity: 0.5, scalesWithCrew: false });

    expect(Number(scaling.quantity)).toBe(1); // stored base, not pre-multiplied

    const resolved = await resolveLoadout(loadout.id, 4);
    const resolvedScaling = resolved.find((i) => i.id === scaling.id);
    const resolvedFlat = resolved.find((i) => i.id === flat.id);
    expect(resolvedScaling?.resolved_quantity).toBe(4);
    expect(resolvedFlat?.resolved_quantity).toBe(0.5);
  });
});

describe("checkouts", () => {
  it("double-checkout of the same asset is structurally impossible", async () => {
    const asset = await registerAsset({ name: "QA Test Wheelie" });
    createdAssetIds.push(asset.id);
    await pool.query("UPDATE assets SET status = 'available' WHERE id = $1", [asset.id]);

    const first = await createCheckout({ assetId: asset.id, checkedOutBy: crewId });
    expect(first.ok).toBe(true);
    if (first.ok) createdCheckoutIds.push(first.checkout.id);

    const second = await createCheckout({ assetId: asset.id, checkedOutBy: managerId });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("asset_not_available");
  });

  it("a damaged return routes the asset to in_maintenance, not back to available -- and clears current_holder", async () => {
    const asset = await registerAsset({ name: "QA Test Compactor 2" });
    createdAssetIds.push(asset.id);
    await pool.query("UPDATE assets SET status = 'available' WHERE id = $1", [asset.id]);

    const checkout = await createCheckout({ assetId: asset.id, checkedOutBy: crewId });
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;
    createdCheckoutIds.push(checkout.checkout.id);

    const pending = await submitForConfirmation({
      actionType: "checkout_return",
      capability: "mcp:tool:submit_checkout_return",
      summary: "damaged return",
      payload: { checkoutId: checkout.checkout.id, returnedBy: crewId, damageFlag: true, damageNote: "cracked housing" },
      submittedByCrewMemberId: crewId,
    });
    const result = await approveConfirmation(pending.id, managerId);
    expect(result.ok).toBe(true);

    const returnedAsset = await getAsset(asset.id);
    expect(returnedAsset?.status).toBe("in_maintenance");
    expect(returnedAsset?.current_holder).toBeNull();
  });

  it("a clean return goes back to available", async () => {
    const asset = await registerAsset({ name: "QA Test Rake" });
    createdAssetIds.push(asset.id);
    await pool.query("UPDATE assets SET status = 'available' WHERE id = $1", [asset.id]);

    const checkout = await createCheckout({ assetId: asset.id, checkedOutBy: crewId, expectedReturnAt: "2020-01-01T00:00:00Z" });
    expect(checkout.ok).toBe(true);
    if (!checkout.ok) return;
    createdCheckoutIds.push(checkout.checkout.id);

    const overdueBefore = await listOverdueCheckouts();
    expect(overdueBefore.some((c) => c.id === checkout.checkout.id)).toBe(true);

    const pending = await submitForConfirmation({
      actionType: "checkout_return",
      capability: "mcp:tool:submit_checkout_return",
      summary: "clean return",
      payload: { checkoutId: checkout.checkout.id, returnedBy: crewId, damageFlag: false },
      submittedByCrewMemberId: crewId,
    });
    await approveConfirmation(pending.id, managerId);

    const returnedAsset = await getAsset(asset.id);
    expect(returnedAsset?.status).toBe("available");

    const overdueAfter = await listOverdueCheckouts();
    expect(overdueAfter.some((c) => c.id === checkout.checkout.id)).toBe(false);
  });
});

describe("orders", () => {
  it("status only ever advances forward, and cancels from any non-terminal status", async () => {
    const order = await createOrder({ requesterId: crewId, siteId: siteA });
    createdOrderIds.push(order.id);

    const backwards = await advanceOrderStatus(order.id, "requested");
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.reason).toBe("not_forward");

    const forward = await advanceOrderStatus(order.id, "confirmed");
    expect(forward.ok).toBe(true);

    const cancelled = await advanceOrderStatus(order.id, "cancelled");
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.order.status).toBe("cancelled");

    const afterTerminal = await advanceOrderStatus(order.id, "picked");
    expect(afterTerminal.ok).toBe(false);
    if (!afterTerminal.ok) expect(afterTerminal.reason).toBe("terminal");
  });
});

describe("transfers", () => {
  it("requires the asset's currently recorded site to equal fromSiteId", async () => {
    const asset = await registerAsset({ name: "QA Test Trencher", currentSiteId: siteA });
    createdAssetIds.push(asset.id);

    const wrongSite = await createTransfer({ assetId: asset.id, fromSiteId: siteB, toSiteId: siteA, requestedBy: crewId });
    expect(wrongSite.ok).toBe(false);
    if (!wrongSite.ok) expect(wrongSite.reason).toBe("asset_not_at_from_site");

    const correct = await createTransfer({ assetId: asset.id, fromSiteId: siteA, toSiteId: siteB, requestedBy: crewId });
    expect(correct.ok).toBe(true);
    if (correct.ok) createdTransferIds.push(correct.transfer.id);
  });

  it("only completing a transfer actually updates the asset's recorded site", async () => {
    const asset = await registerAsset({ name: "QA Test Excavator", currentSiteId: siteA });
    createdAssetIds.push(asset.id);
    const transfer = await createTransfer({ assetId: asset.id, fromSiteId: siteA, toSiteId: siteB, requestedBy: crewId });
    expect(transfer.ok).toBe(true);
    if (!transfer.ok) return;
    createdTransferIds.push(transfer.transfer.id);

    await advanceTransferStatus(transfer.transfer.id, "in_transit");
    const stillAtA = await getAsset(asset.id);
    expect(stillAtA?.current_site_id).toBe(siteA);

    await advanceTransferStatus(transfer.transfer.id, "completed");
    const movedToB = await getAsset(asset.id);
    expect(movedToB?.current_site_id).toBe(siteB);
  });
});

describe("purchase orders", () => {
  it("fails to compile with no order items, and fulfillment is only legal from sent_to_office/forwarded_by_office", async () => {
    const emptyOrder = await createOrder({ requesterId: crewId, siteId: siteA });
    createdOrderIds.push(emptyOrder.id);
    const emptyCompile = await compilePurchaseOrder(emptyOrder.id);
    expect(emptyCompile.ok).toBe(false);
    if (!emptyCompile.ok) expect(emptyCompile.reason).toBe("no_items");

    const order = await createOrder({ requesterId: crewId, siteId: siteA });
    createdOrderIds.push(order.id);
    const consumable = await registerConsumable({ name: "QA Interlock Bricks", unit: "sqft", stockingType: "per_job_delivery" });
    createdConsumableIds.push(consumable.id);
    await addOrderItem({ orderId: order.id, consumableId: consumable.id, quantity: 200 });

    const compiled = await compilePurchaseOrder(order.id);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    createdPurchaseOrderIds.push(compiled.purchaseOrder.id);

    // Fulfillment before sending must be denied -- not yet in a fulfillable status.
    const tooEarly = await submitForConfirmation({
      actionType: "purchase_order_fulfillment",
      capability: "mcp:tool:submit_purchase_order_fulfillment",
      summary: "too early",
      payload: { purchaseOrderId: compiled.purchaseOrder.id, crewMemberId: crewId },
      submittedByCrewMemberId: crewId,
    });
    await expect(approveConfirmation(tooEarly.id, managerId)).rejects.toThrow(/not_fulfillable/);

    const sent = await sendPurchaseOrder(compiled.purchaseOrder.id, "info@example.test");
    expect(sent.ok).toBe(true);

    const pending = await submitForConfirmation({
      actionType: "purchase_order_fulfillment",
      capability: "mcp:tool:submit_purchase_order_fulfillment",
      summary: "delivered",
      payload: { purchaseOrderId: compiled.purchaseOrder.id, crewMemberId: crewId },
      submittedByCrewMemberId: crewId,
    });
    const result = await approveConfirmation(pending.id, managerId);
    expect(result.ok).toBe(true);
  });
});
