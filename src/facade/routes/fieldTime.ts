// Task #156 slice H (field-time) -- the module the plan's own scope
// table listed among the 8 kept modules but whose sequencing section
// never allocated a slice to; built now, before the frontend pruning
// pass, so pruning doesn't have to guess whether this route survives.
//
// Maps timeclockSessions.ts's computed in/break/out state machine (real
// domain logic, already used by payroll's reconciliation) onto the
// vendored frontend's much richer FieldTimesheet/FieldTimesheetLine
// model -- a real cost-coded, signed, project-scoped timesheet with a
// draft->submitted->approved->reversed lifecycle -- confirmed exact
// field names by reading the frontend's own src/features/field-time/
// api.ts, not guessed.
//
// This domain has no timesheet concept at all, so one is synthesized:
// one FieldTimesheet per (crew member, calendar day), one
// FieldTimesheetLine per session that crew member had that day (almost
// always exactly one -- a second session on the same day is rare but
// not impossible, e.g. clocking back in after a long unpaid break).
// `resource_id` on each line is the crew member's id -- the exact id
// the resources façade route (Slice G) already reports crew members
// under, so a line and its worker resolve consistently across both
// modules. `equipment_id` is always null: timeclock has no concept of
// plant time. Status is always the fixed stub `'draft'` -- same honest
// choice payroll made for the same reason, nothing in this domain
// tracks or gates a submit/approve/reverse transition, so claiming any
// other status would assert a workflow that never happened.
//
// Like every other project-scoped module in this task (payroll,
// site-inventory, procurement, teams), FieldTimePage.tsx gates its
// queries on `enabled: !!projectId` -- confirmed by reading it -- so
// `project_id` is accepted wherever the frontend sends it and echoed
// back, never validated or persisted against anything.
//
// Deliberately NOT built here (see docs/ARCHITECTURE.md Task #156 scope
// table): line CRUD (add/update/delete -- a line here is derived
// wholesale from clock events, not something to hand-edit), the
// submit/approve/reverse lifecycle (no gate exists to advance past
// 'draft'), offline capture (this domain's own timeclock event stream
// already is the offline-tolerant path -- WhatsApp-native, Phase-3
// scope, not this façade), the statutory working-time record/export
// (no regime concept exists), and AI cost-code suggestion (no cost-code
// vocabulary exists to suggest from -- lines report cost_code: "").
import type { Router } from "../router.js";
import { getQueryInt, getQueryParam, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { fetchSessionsInRange, type TimeclockSession } from "../../domain/timeclockSessions.js";
import { getNotificationSettings } from "../../domain/notificationSettings.js";
import { getCrewMember } from "../../domain/crewMembers.js";

const SYNTHETIC_STATUS = "draft";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// No date_from/date_to given -> the current calendar month, same
// default payroll's synthetic batch uses and for the same reason: an
// unbounded "give me everything" query against a live event table has
// no natural stopping point in a domain with no archival/closing concept.
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: from.toISOString(), to: now.toISOString() };
}

function toLine(session: TimeclockSession, timesheetId: string) {
  const hours = session.netSeconds != null ? (session.netSeconds / 3600).toFixed(4) : "0.0000";
  return {
    id: `${timesheetId}:${session.startedAt.toISOString()}`,
    timesheet_id: timesheetId,
    resource_id: session.crewMemberId,
    equipment_id: null,
    hours,
    cost_code: "",
    wbs: null,
    is_daywork: false,
    variation_id: null,
    daywork_sheet_id: null,
    note: session.incomplete ? "Incomplete session -- no clock-out recorded." : null,
    kind: "labour" as const,
    started_at: session.startedAt.toISOString(),
    ended_at: session.endedAt?.toISOString() ?? null,
    break_minutes: Math.round(session.breakSeconds / 60),
    employer_kind: null,
    employer_subcontractor_id: null,
    hours_derived: true,
    created_at: session.startedAt.toISOString(),
    updated_at: (session.endedAt ?? session.startedAt).toISOString(),
  };
}

async function buildTimesheets(projectId: string, from: string, to: string) {
  const settings = await getNotificationSettings();
  const sessions = await fetchSessionsInRange({
    from,
    to,
    dailyOvertimeHours: settings.daily_overtime_hours,
    breakRequiredAfterHours: settings.break_required_after_hours,
  });

  const groups = new Map<string, TimeclockSession[]>();
  for (const session of sessions) {
    const key = `${session.crewMemberId}:${dayKey(session.startedAt)}`;
    const group = groups.get(key);
    if (group) group.push(session);
    else groups.set(key, [session]);
  }

  const timesheets = await Promise.all([...groups.entries()].map(async ([id, group]) => {
    const crew = await getCrewMember(group[0].crewMemberId);
    const lines = group.map((s) => toLine(s, id));
    const labourHours = lines.reduce((sum, l) => sum + Number(l.hours), 0);
    const date = dayKey(group[0].startedAt);
    return {
      id,
      project_id: projectId,
      reference: `${crew?.name ?? "Unknown"} -- ${date}`,
      date,
      status: SYNTHETIC_STATUS,
      submitted_by: null,
      submitted_at: null,
      approved_by: null,
      approved_at: null,
      reverses_id: null,
      note: null,
      metadata: {},
      working_time_regime: null,
      working_time: null,
      lines,
      labour_hours: labourHours.toFixed(4),
      plant_hours: "0.0000",
      created_at: group[0].startedAt.toISOString(),
      updated_at: (group[group.length - 1].endedAt ?? group[group.length - 1].startedAt).toISOString(),
    };
  }));

  return timesheets.sort((a, b) => b.date.localeCompare(a.date));
}

export function registerFieldTimeRoutes(router: Router): void {
  // Registered before the :id route below -- "summary" would otherwise
  // be swallowed by the :id pattern's single-segment wildcard.
  router.get("/api/v1/field-time/timesheets/summary/", async (req, res) => {
    try {
      await requireStaffRole(req);
      const projectId = getQueryParam(req, "project_id") ?? "";
      const { from, to } = defaultRange();
      const timesheets = await buildTimesheets(projectId, from, to);
      sendJson(res, 200, {
        total: timesheets.length,
        by_status: { [SYNTHETIC_STATUS]: timesheets.length },
        labour_hours: timesheets.reduce((sum, t) => sum + Number(t.labour_hours), 0).toFixed(4),
        plant_hours: "0.0000",
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/field-time/timesheets/", async (req, res) => {
    try {
      await requireStaffRole(req);
      const projectId = getQueryParam(req, "project_id") ?? "";
      const status = getQueryParam(req, "status");
      // Every synthetic timesheet reports the same stub status -- asking
      // for anything else is emulated as "no matches", same pattern as
      // equipment's stub-status filter.
      if (status && status !== SYNTHETIC_STATUS) {
        sendJson(res, 200, []);
        return;
      }
      const { from, to } = defaultRange();
      const dateFrom = getQueryParam(req, "date_from") ?? from;
      const dateTo = getQueryParam(req, "date_to") ?? to;
      const offset = getQueryInt(req, "offset", 0);
      const limit = getQueryInt(req, "limit", 50);
      const all = await buildTimesheets(projectId, dateFrom, dateTo);
      sendJson(res, 200, all.slice(offset, offset + limit));
    } catch (err) {
      sendError(res, err);
    }
  });

  router.get("/api/v1/field-time/timesheets/:id/", async (req, res, { id }) => {
    try {
      await requireStaffRole(req);
      const [crewMemberId, date] = id.split(":");
      if (!crewMemberId || !date) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      const dayStart = new Date(`${date}T00:00:00.000Z`).toISOString();
      const dayEnd = new Date(`${date}T23:59:59.999Z`).toISOString();
      const timesheets = await buildTimesheets("", dayStart, dayEnd);
      const found = timesheets.find((t) => t.id === id);
      if (!found) {
        sendJson(res, 404, { detail: "Not found" });
        return;
      }
      sendJson(res, 200, found);
    } catch (err) {
      sendError(res, err);
    }
  });
}
