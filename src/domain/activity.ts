// Dashboard restoration, Slice K: a cross-module "recent activity" feed,
// synthesized the same way fieldTime.ts synthesizes timesheets --
// nothing here is its own stored concept, it's assembled from events
// several existing domains already record with a real timestamp and
// (where one exists) a real actor. Only sources with a genuine actor +
// timestamp pair are included: alerts (raised/resolved), notifications
// (raised/acknowledged), purchase orders (compiled/fulfilled), documents
// (uploaded), and timeclock sessions (clocked in/out). Consumable stock
// adjustments were deliberately left out -- there is no adjustment
// ledger, only a current quantity_on_hand, so there is nothing with a
// real per-event actor/timestamp to report.
import { listAlerts, alertLinkForType, type AlertType } from "./alerts.js";
import { listNotifications } from "./notifications.js";
import { listPurchaseOrders } from "./purchaseOrders.js";
import { listDocuments } from "./documents.js";
import { getVendor } from "./vendors.js";
import { getCrewMember } from "./crewMembers.js";
import { getUser } from "./users.js";
import { fetchSessionsInRange } from "./timeclockSessions.js";
import { getNotificationSettings } from "./notificationSettings.js";

export type ActivityEntry = {
  id: string;
  type:
    | "alert_raised" | "alert_resolved"
    | "notification_raised" | "notification_acknowledged"
    | "purchase_order_created" | "purchase_order_fulfilled"
    | "document_uploaded"
    | "timeclock_in" | "timeclock_out";
  title: string;
  actor_name: string | null;
  timestamp: string;
  action_url: string | null;
};

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  idle: "Idle", delay: "Delay", wrong_site: "Wrong site", order_stalled: "Order stalled",
  loadout_gap: "Loadout gap", overdue: "Overdue", vehicle_dark: "Vehicle went dark",
  weather: "Weather", dashboard_unreachable: "Dashboard unreachable", maintenance_due: "Maintenance due",
  backup_failed: "Backup failed", cron_job_failed: "Scheduled job failed", connectivity_degraded: "Connectivity degraded",
  disk_space_low: "Disk space low", it_issue: "IT issue", system_offline: "System offline",
  crew_location_stale: "Crew location stale", crew_off_site: "Crew off site",
};

// The domain types above declare timestamp fields as `string`, but node-
// postgres actually hands back a `Date` object for TIMESTAMPTZ columns --
// the `string` annotation only holds true once JSON.stringify coerces it
// on the way out. Sorting entries here happens before that coercion, so
// every timestamp is normalized explicitly rather than trusted at face value.
function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function resolveActorName(crewMemberId: string | null, userId: string | null): Promise<string | null> {
  if (userId) {
    const user = await getUser(userId);
    if (user) return user.name;
  }
  if (crewMemberId) {
    const crew = await getCrewMember(crewMemberId);
    if (crew) return crew.name;
  }
  return null;
}

// Bounded to the last 14 days -- an unbounded "give me every clock event
// ever" query has no natural stopping point in a live event table, same
// reasoning fieldTime.ts's own default range comment gives.
function recentWindow(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function listRecentActivity(limit = 30): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = [];

  const alerts = await listAlerts();
  const alertsById = new Map(alerts.map((a) => [a.id, a]));
  for (const a of alerts) {
    const label = ALERT_TYPE_LABELS[a.type];
    const link = alertLinkForType(a.type);
    entries.push({ id: `alert:${a.id}:raised`, type: "alert_raised", title: `Alert raised: ${label}`, actor_name: null, timestamp: toIso(a.raised_at), action_url: link });
    if (a.resolved_at) {
      entries.push({
        id: `alert:${a.id}:resolved`, type: "alert_resolved", title: `Alert resolved: ${label}`,
        actor_name: await resolveActorName(a.resolved_by, a.resolved_by_user_id), timestamp: toIso(a.resolved_at), action_url: link,
      });
    }
  }

  // A notification's source_id points at the alert that raised it (the
  // only path that creates one today) -- resolved against the alerts
  // already fetched above rather than a fresh query per notification.
  const { items: notifications } = await listNotifications({ limit: 200, offset: 0 });
  for (const n of notifications) {
    const relatedAlert = n.source_type === "alert" && n.source_id ? alertsById.get(n.source_id) : undefined;
    const link = relatedAlert ? alertLinkForType(relatedAlert.type) : null;
    entries.push({ id: `notification:${n.id}:raised`, type: "notification_raised", title: n.message, actor_name: null, timestamp: toIso(n.created_at), action_url: link });
    if (n.acknowledged_at) {
      entries.push({
        id: `notification:${n.id}:acknowledged`, type: "notification_acknowledged", title: `Acknowledged: ${n.message}`,
        actor_name: await resolveActorName(n.acknowledged_by, n.acknowledged_by_user_id), timestamp: toIso(n.acknowledged_at), action_url: link,
      });
    }
  }

  const purchaseOrders = await listPurchaseOrders();
  for (const po of purchaseOrders) {
    const vendor = po.vendor_id ? await getVendor(po.vendor_id) : null;
    const label = vendor ? `Purchase order for ${vendor.name}` : "Purchase order";
    entries.push({ id: `po:${po.id}:created`, type: "purchase_order_created", title: `${label} compiled`, actor_name: null, timestamp: toIso(po.created_at), action_url: "/procurement" });
    if (po.fulfilled_at) {
      entries.push({
        id: `po:${po.id}:fulfilled`, type: "purchase_order_fulfilled", title: `${label} fulfilled`,
        actor_name: po.fulfilled_by ? (await getCrewMember(po.fulfilled_by))?.name ?? null : null, timestamp: toIso(po.fulfilled_at), action_url: "/procurement",
      });
    }
  }

  const documents = await listDocuments();
  for (const d of documents) {
    entries.push({
      id: `document:${d.id}`, type: "document_uploaded", title: `Document uploaded: ${d.filename}`,
      actor_name: d.uploaded_by ? (await getCrewMember(d.uploaded_by))?.name ?? null : null, timestamp: toIso(d.uploaded_at), action_url: null,
    });
  }

  const settings = await getNotificationSettings();
  const { from, to } = recentWindow();
  const sessions = await fetchSessionsInRange({ from, to, dailyOvertimeHours: settings.daily_overtime_hours, breakRequiredAfterHours: settings.break_required_after_hours });
  for (const s of sessions) {
    const crew = await getCrewMember(s.crewMemberId);
    const name = crew?.name ?? "Unknown";
    entries.push({ id: `timeclock:${s.crewMemberId}:${s.startedAt.toISOString()}:in`, type: "timeclock_in", title: `${name} clocked in`, actor_name: name, timestamp: s.startedAt.toISOString(), action_url: "/field-time" });
    if (s.endedAt) {
      entries.push({ id: `timeclock:${s.crewMemberId}:${s.startedAt.toISOString()}:out`, type: "timeclock_out", title: `${name} clocked out`, actor_name: name, timestamp: s.endedAt.toISOString(), action_url: "/field-time" });
    }
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return entries.slice(0, limit);
}
