// Read-only chat assistant verification: the tool registry against real
// domain data (no mocking, same convention as every other test in this
// project), and the orchestration loop against an injected fake LLM
// provider -- runChatTurn's own logic (message threading, executing
// requested tools, feeding results back) is real code worth testing,
// but the actual DeepSeek/Anthropic HTTP calls are not: no key is
// configured anywhere in this environment yet (see docs/ARCHITECTURE.md's
// chat status entry), and even once one is, a live LLM call has no
// place in an automated test (slow, non-deterministic, costs money).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../src/db/pool.js";
import { registerCrewMember } from "../src/domain/crewMembers.js";
import { setCrewPayProfile } from "../src/domain/payroll.js";
import { raiseAlert, resolveAlert } from "../src/domain/alerts.js";
import { registerVehicle } from "../src/domain/vehicles.js";
import { createTimeclockEntry } from "../src/domain/timeclock.js";
import { createFreeformPurchaseOrder } from "../src/domain/purchaseOrders.js";
import { registerConsumable } from "../src/domain/consumables.js";
import { registerSite } from "../src/domain/sites.js";
import { TOOLS, runChatTurn, type LlmProvider, type ChatMessage } from "../src/domain/chat.js";

const createdCrewIds: string[] = [];
const createdCrewDids: string[] = [];
const createdVehicleIds: string[] = [];
const createdAlertIds: string[] = [];
const createdTimeclockEntryIds: string[] = [];
const createdPoIds: string[] = [];
const createdConsumableIds: string[] = [];
const createdSiteIds: string[] = [];

afterAll(async () => {
  await pool.query("DELETE FROM sites WHERE id = ANY($1)", [createdSiteIds]);
  await pool.query("DELETE FROM consumables WHERE id = ANY($1)", [createdConsumableIds]);
  await pool.query("DELETE FROM purchase_order_items WHERE purchase_order_id = ANY($1)", [createdPoIds]);
  await pool.query("DELETE FROM purchase_orders WHERE id = ANY($1)", [createdPoIds]);
  await pool.query("DELETE FROM timeclock_entries WHERE id = ANY($1)", [createdTimeclockEntryIds]);
  await pool.query("DELETE FROM alerts WHERE id = ANY($1)", [createdAlertIds]);
  await pool.query("DELETE FROM notifications WHERE source_id = ANY($1)", [createdAlertIds]);
  await pool.query("DELETE FROM vehicles WHERE id = ANY($1)", [createdVehicleIds]);
  await pool.query("DELETE FROM crew_pay_profiles WHERE crew_member_id = ANY($1)", [createdCrewIds]);
  await pool.query("DELETE FROM capability_grants WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM verifiable_credentials WHERE subject_did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM keys WHERE did = ANY($1)", [createdCrewDids]);
  await pool.query("DELETE FROM crew_members WHERE id = ANY($1)", [createdCrewIds]);
  await pool.end();
});

function findTool(name: string) {
  const tool = TOOLS.find((t) => t.name === name);
  expect(tool, `tool '${name}' not registered`).toBeTruthy();
  return tool!;
}

describe("tool registry", () => {
  it("list_crew finds a real, freshly registered crew member", async () => {
    const crew = await registerCrewMember({ name: "QA Chat Crew", phone: "+15559991701" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const result = (await findTool("list_crew").handler({})) as { id: string; name: string }[];
    expect(result.some((c) => c.id === crew.id && c.name === "QA Chat Crew")).toBe(true);
  });

  it("list_equipment finds a real, freshly registered vehicle", async () => {
    const vehicle = await registerVehicle({ plate: "QA-CHAT-001" });
    createdVehicleIds.push(vehicle.id);

    const result = (await findTool("list_equipment").handler({})) as { id: string; plate: string }[];
    expect(result.some((v) => v.id === vehicle.id && v.plate === "QA-CHAT-001")).toBe(true);
  });

  it("list_active_alerts finds an unresolved alert and correctly excludes it once resolved", async () => {
    const crew = await registerCrewMember({ name: "QA Chat Resolver", phone: "+15559991702" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    const { alert } = await raiseAlert({ type: "idle", summary: "QA chat tool test" });
    createdAlertIds.push(alert.id);

    const beforeResolve = (await findTool("list_active_alerts").handler({})) as { id: string }[];
    expect(beforeResolve.some((a) => a.id === alert.id)).toBe(true);

    await resolveAlert(alert.id, { crewMemberId: crew.id });
    const afterResolve = (await findTool("list_active_alerts").handler({})) as { id: string }[];
    expect(afterResolve.some((a) => a.id === alert.id)).toBe(false);
  });

  it("get_crew_payroll_summary reports the crew member's name and a real reconciliation, and an error for an unknown id", async () => {
    const crew = await registerCrewMember({ name: "QA Chat Payroll", phone: "+15559991703" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);
    await setCrewPayProfile(crew.id, { hourlyRate: 30 });

    const result = (await findTool("get_crew_payroll_summary").handler({ crew_member_id: crew.id })) as { crew_member_name: string; hourlyRate: number };
    expect(result.crew_member_name).toBe("QA Chat Payroll");
    expect(result.hourlyRate).toBe(30);

    const missing = (await findTool("get_crew_payroll_summary").handler({ crew_member_id: "00000000-0000-0000-0000-000000000000" })) as { error: string };
    expect(missing.error).toBeTruthy();
  });

  it("list_crew with status 'clocked_in' includes only a crew member with an open session today", async () => {
    const clockedIn = await registerCrewMember({ name: "QA Chat Clocked In", phone: "+15559991705" });
    createdCrewIds.push(clockedIn.id);
    createdCrewDids.push(clockedIn.did);
    const notClockedIn = await registerCrewMember({ name: "QA Chat Not Clocked In", phone: "+15559991706" });
    createdCrewIds.push(notClockedIn.id);
    createdCrewDids.push(notClockedIn.did);

    const entry = await createTimeclockEntry({ crewMemberId: clockedIn.id, eventType: "in", geofenceVerified: false });
    createdTimeclockEntryIds.push(entry.id);

    const all = (await findTool("list_crew").handler({})) as { id: string }[];
    expect(all.some((c) => c.id === clockedIn.id)).toBe(true);
    expect(all.some((c) => c.id === notClockedIn.id)).toBe(true);

    const clockedInOnly = (await findTool("list_crew").handler({ status: "clocked_in" })) as { id: string }[];
    expect(clockedInOnly.some((c) => c.id === clockedIn.id)).toBe(true);
    expect(clockedInOnly.some((c) => c.id === notClockedIn.id)).toBe(false);
  });

  it("get_kpis returns the same five KPI shapes as the BI dashboard", async () => {
    const result = (await findTool("get_kpis").handler({})) as {
      open_alerts: { critical: number; routine: number };
      crew_utilization: { clocked_in_today: number; active_crew: number };
      avg_alert_resolution: { resolved_count: number };
      po_spend_this_month: unknown[];
      timeclock_hours_this_week: { total_hours: number };
    };
    expect(result.open_alerts.critical).toBeGreaterThanOrEqual(0);
    expect(result.crew_utilization.active_crew).toBeGreaterThanOrEqual(0);
    expect(result.avg_alert_resolution.resolved_count).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.po_spend_this_month)).toBe(true);
    expect(result.timeclock_hours_this_week.total_hours).toBeGreaterThanOrEqual(0);
  });

  it("list_purchase_orders finds a real freeform PO and filters correctly by status", async () => {
    const po = await createFreeformPurchaseOrder({ cost: 42, items: [{ description: "QA chat tool PO item" }] });
    createdPoIds.push(po.id);

    const all = (await findTool("list_purchase_orders").handler({})) as { id: string; status: string }[];
    const found = all.find((p) => p.id === po.id);
    expect(found).toBeTruthy();

    const matching = (await findTool("list_purchase_orders").handler({ status: found!.status })) as { id: string }[];
    expect(matching.some((p) => p.id === po.id)).toBe(true);

    const nonMatchingStatus = found!.status === "fulfilled" ? "compiled" : "fulfilled";
    const nonMatching = (await findTool("list_purchase_orders").handler({ status: nonMatchingStatus })) as { id: string }[];
    expect(nonMatching.some((p) => p.id === po.id)).toBe(false);
  });

  it("list_consumables with low_stock_only finds a freshly registered stocked item (starts at 0 on-hand)", async () => {
    const consumable = await registerConsumable({ name: "QA Chat Consumable", unit: "each", stockingType: "stocked", reorderThreshold: 5 });
    createdConsumableIds.push(consumable.id);

    const all = (await findTool("list_consumables").handler({})) as { id: string }[];
    expect(all.some((c) => c.id === consumable.id)).toBe(true);

    const lowStock = (await findTool("list_consumables").handler({ low_stock_only: true })) as { id: string }[];
    expect(lowStock.some((c) => c.id === consumable.id)).toBe(true);
  });

  it("list_sites finds a real, freshly registered site", async () => {
    const site = await registerSite({ name: "QA Chat Site", type: "job_site" });
    createdSiteIds.push(site.id);

    const result = (await findTool("list_sites").handler({})) as { id: string; crew_today_count: number; open_alerts_count: number }[];
    const found = result.find((s) => s.id === site.id);
    expect(found).toBeTruthy();
    expect(found!.crew_today_count).toBeGreaterThanOrEqual(0);
    expect(found!.open_alerts_count).toBeGreaterThanOrEqual(0);
  });
});

describe("runChatTurn orchestration", () => {
  it("returns the model's content directly when it requests no tools", async () => {
    const fakeLlm: LlmProvider = async () => ({ content: "There are 3 crew members.", toolCalls: [] });
    const result = await runChatTurn("How many crew members are there?", [], fakeLlm);
    expect(result.reply).toBe("There are 3 crew members.");
    expect(result.toolCalls).toEqual([]);
  });

  it("executes a requested tool, feeds the result back, and returns the model's follow-up answer", async () => {
    const crew = await registerCrewMember({ name: "QA Chat Orchestration", phone: "+15559991704" });
    createdCrewIds.push(crew.id);
    createdCrewDids.push(crew.did);

    let round = 0;
    const fakeLlm: LlmProvider = async (messages) => {
      round += 1;
      if (round === 1) {
        return { content: null, toolCalls: [{ id: "call_1", name: "list_crew", arguments: {} }] };
      }
      // Second round: the tool result must actually be in the message history.
      const toolMsg = messages.find((m) => m.role === "tool");
      expect(toolMsg).toBeTruthy();
      expect(toolMsg!.content).toContain("QA Chat Orchestration");
      return { content: "Found the crew member.", toolCalls: [] };
    };

    const result = await runChatTurn("Is QA Chat Orchestration active?", [], fakeLlm);
    expect(result.reply).toBe("Found the crew member.");
    expect(result.toolCalls).toEqual([{ name: "list_crew", arguments: {} }]);
    expect(round).toBe(2);
  });

  it("reports an unknown tool name as a tool-result error rather than throwing", async () => {
    let round = 0;
    const fakeLlm: LlmProvider = async (messages) => {
      round += 1;
      if (round === 1) {
        return { content: null, toolCalls: [{ id: "call_1", name: "delete_everything", arguments: {} }] };
      }
      const toolMsg = messages.find((m) => m.role === "tool");
      expect(toolMsg!.content).toContain("Unknown tool");
      return { content: "That's not something I can do.", toolCalls: [] };
    };
    const result = await runChatTurn("Delete everything", [], fakeLlm);
    expect(result.reply).toBe("That's not something I can do.");
  });

  it("gives up after MAX_TOOL_ROUNDS rather than looping forever", async () => {
    const fakeLlm: LlmProvider = async () => ({ content: null, toolCalls: [{ id: "call_x", name: "list_crew", arguments: {} }] });
    const result = await runChatTurn("Loop forever", [], fakeLlm);
    expect(result.reply).toMatch(/couldn't finish/i);
  });

  it("seeds the conversation with prior history", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "What's my name?" },
      { role: "assistant", content: "I don't know your name." },
    ];
    let seenHistory = false;
    const fakeLlm: LlmProvider = async (messages) => {
      seenHistory = messages.some((m) => m.role === "assistant" && m.content === "I don't know your name.");
      return { content: "ok", toolCalls: [] };
    };
    await runChatTurn("Follow-up question", history, fakeLlm);
    expect(seenHistory).toBe(true);
  });
});
