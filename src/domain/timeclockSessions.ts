// Re-expressed from v1's timeclock session-derivation logic
// (computeSessions/fetchSessionsInRange) -- requirements baseline, not
// copied code. State machine: in -> (break_start -> break_end)* -> out.
// A session with no matching 'out' comes back incomplete -- net_seconds
// stays null, never guessed/estimated. gross (clock-in to clock-out span,
// NOT net of breaks) is what's compared against the overtime/break
// thresholds -- using net would make a compliant break look like it
// shortened the shift below the very threshold that required it, same
// reasoning v1 gives.
import { pool } from "../db/pool.js";

export type TimeclockSession = {
  crewMemberId: string;
  startedAt: Date;
  endedAt: Date | null;
  breakSeconds: number;
  netSeconds: number | null;
  grossHours: number | null;
  incomplete: boolean;
  overtime: boolean;
  missedBreak: boolean;
  siteIds: string[];
  geofenceVerified: boolean;
};

type RawEvent = { crew_member_id: string; event_type: string; timestamp: string; site_id: string | null; geofence_verified: boolean };

export async function fetchSessionsInRange(args: {
  crewMemberId?: string;
  from: string;
  to: string;
  dailyOvertimeHours: number;
  breakRequiredAfterHours: number;
}): Promise<TimeclockSession[]> {
  const conditions = [`"timestamp" >= $1`, `"timestamp" <= $2`];
  const params: unknown[] = [args.from, args.to];
  if (args.crewMemberId) {
    params.push(args.crewMemberId);
    conditions.push(`crew_member_id = $${params.length}`);
  }
  const result = await pool.query(
    `SELECT crew_member_id, event_type, "timestamp", site_id, geofence_verified
     FROM timeclock_entries WHERE ${conditions.join(" AND ")} ORDER BY crew_member_id, "timestamp"`,
    params,
  );
  return computeSessions(result.rows as RawEvent[], args.dailyOvertimeHours, args.breakRequiredAfterHours);
}

export function computeSessions(events: RawEvent[], dailyOvertimeHours: number, breakRequiredAfterHours: number): TimeclockSession[] {
  const sessions: TimeclockSession[] = [];
  let current: { crewMemberId: string; startedAt: Date; breakSeconds: number; breakStart: Date | null; siteIds: Set<string>; allVerified: boolean } | null = null;

  // Callers pass events sorted by (crew_member_id, timestamp) across
  // potentially many crew members in one query result -- a real bug,
  // caught by CI against a fresh database (never surfaced against a
  // long-lived local dev DB with only a handful of crew members active
  // at once): the old code tracked one shared `current` session with no
  // ownership check at all. A crew member's dangling open 'in' (no
  // matching 'out' yet) would silently absorb the *next* crew member's
  // events in the list -- their 'out' would incorrectly close someone
  // else's session, and a session still open at the very end of the
  // whole result set got attributed to whichever crew member's row
  // happened to sort last, not whoever it actually belonged to. Real
  // payroll-reconciliation implications, not just a display glitch.
  // Fixed by closing out any dangling session the instant the
  // crew_member_id changes, same as if that crew member's window had
  // ended right there.
  for (const event of events) {
    const timestamp = new Date(event.timestamp);
    if (current && current.crewMemberId !== event.crew_member_id) {
      sessions.push({
        crewMemberId: current.crewMemberId,
        startedAt: current.startedAt,
        endedAt: null,
        breakSeconds: current.breakSeconds,
        netSeconds: null,
        grossHours: null,
        incomplete: true,
        overtime: false,
        missedBreak: false,
        siteIds: [...current.siteIds],
        geofenceVerified: current.allVerified,
      });
      current = null;
    }

    if (event.event_type === "in") {
      current = { crewMemberId: event.crew_member_id, startedAt: timestamp, breakSeconds: 0, breakStart: null, siteIds: new Set(), allVerified: true };
    }
    if (!current) continue; // a break/out event with no preceding 'in' in this window is ignored, same as v1's session-boundary handling
    if (event.site_id) current.siteIds.add(event.site_id);
    if (!event.geofence_verified) current.allVerified = false;

    if (event.event_type === "break_start") {
      current.breakStart = timestamp;
    } else if (event.event_type === "break_end" && current.breakStart) {
      current.breakSeconds += (timestamp.getTime() - current.breakStart.getTime()) / 1000;
      current.breakStart = null;
    } else if (event.event_type === "out") {
      const grossSeconds = (timestamp.getTime() - current.startedAt.getTime()) / 1000;
      const grossHours = grossSeconds / 3600;
      sessions.push({
        crewMemberId: current.crewMemberId,
        startedAt: current.startedAt,
        endedAt: timestamp,
        breakSeconds: current.breakSeconds,
        netSeconds: grossSeconds - current.breakSeconds,
        grossHours,
        incomplete: false,
        overtime: grossHours > dailyOvertimeHours,
        missedBreak: grossHours > breakRequiredAfterHours && current.breakSeconds === 0,
        siteIds: [...current.siteIds],
        geofenceVerified: current.allVerified,
      });
      current = null;
    }
  }

  // A still-open session at the end of the window is incomplete -- never
  // guessed/estimated, same as v1. Now correctly attributed to whichever
  // crew member's own 'in' actually opened it (current.crewMemberId),
  // not the last row in the whole result set.
  if (current) {
    sessions.push({
      crewMemberId: current.crewMemberId,
      startedAt: current.startedAt,
      endedAt: null,
      breakSeconds: current.breakSeconds,
      netSeconds: null,
      grossHours: null,
      incomplete: true,
      overtime: false,
      missedBreak: false,
      siteIds: [...current.siteIds],
      geofenceVerified: current.allVerified,
    });
  }

  return sessions;
}
