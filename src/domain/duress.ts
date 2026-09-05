// Duress/panic alerts (DOMAIN-DESIGN.md §3, resolved 2026-09-04). Not a
// new table -- a specific incidents.category = 'duress' row with severity
// forced to 'critical' at creation, reusing the same action/escalation
// machinery incidents.ts already has. The distinguishing behavior is
// entirely the alerting path: payload is location + timestamp only (no
// audio/video, per the resolved decision), and it pages every
// active supervisor/admin, not the normal notification-priority queue.
//
// Simplification flagged here, not silently assumed: "every supervisor
// overseeing that site" (the resolved design's exact words) would need a
// site-supervisor assignment concept this domain doesn't have yet -- this
// pages every active supervisor/admin guard system-wide instead, a
// broader net than the resolved design technically asked for. Narrow this
// once site-level supervisor assignment exists.
//
// Also not built here: the "most aggressive re-page-until-acknowledged"
// escalation behavior the resolved design calls for (repeated paging on a
// timer until an incident_action acknowledges it) -- this does one
// fan-out at trigger time, not a recurring escalation poller. That's real
// follow-up work (an exceptions.ts-style poller, per
// PRECEDENT-ARCHITECTURE.md §6), not scoped into this first cut.
import { reportIncident, type Incident } from "./incidents.js";
import { listGuards } from "./guards.js";
import { sendMessage } from "./messages.js";

export type DuressAlertResult = { incident: Incident; supervisorsPaged: number };

export async function triggerDuressAlert(args: {
  guardId: string;
  siteId: string;
  lat: number;
  lng: number;
}): Promise<DuressAlertResult> {
  const incident = await reportIncident({
    siteId: args.siteId,
    reportedByGuardId: args.guardId,
    category: "duress",
    severity: "critical",
    summary: "Duress alert triggered",
    lat: args.lat,
    lng: args.lng,
  });

  const supervisors = (await listGuards({ role: "supervisor", active: true })).concat(
    await listGuards({ role: "admin", active: true }),
  );

  let paged = 0;
  for (const supervisor of supervisors) {
    await sendMessage({
      senderId: args.guardId,
      recipientId: supervisor.id,
      siteId: args.siteId,
      body: `DURESS ALERT -- incident ${incident.id} at site ${args.siteId}, location ${args.lat},${args.lng}`,
    });
    paged += 1;
  }

  return { incident, supervisorsPaged: paged };
}
