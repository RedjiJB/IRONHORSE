// Dashboard restoration, Slice L: the vendored InboxPanel.tsx models a
// per-user, reversible triage state (acknowledge/dismiss/restore, an
// "Undo" button) layered ON TOP of whatever the item actually is --
// dismissing an approval "never decides it". This domain has no such
// layer: resolveAlert/acknowledgeNotification are real, one-way, global
// actions (there is no "unresolve"). Wiring the vendored panel's
// buttons to them would render a working "Undo" control next to an
// action that cannot actually be undone -- a fake affordance. Built a
// purpose-built inbox widget instead (see
// features/dashboard/components/InboxCard.tsx), same call as
// RecentActivityCard made for ActivityFeed.tsx.
//
// There is also no PO-approval-gate concept in this domain (confirmed:
// purchaseOrders.ts has no approval status) -- this inbox is alerts +
// notifications only, never a fabricated "approvals" bucket.
import type { Router } from "../router.js";
import { getQueryInt, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import { listAlerts, resolveAlert, getAlert, alertLinkForType, type AlertType } from "../../domain/alerts.js";
import { listNotifications, acknowledgeNotification } from "../../domain/notifications.js";

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  idle: "Idle", delay: "Delay", wrong_site: "Wrong site", order_stalled: "Order stalled",
  loadout_gap: "Loadout gap", overdue: "Overdue", vehicle_dark: "Vehicle went dark",
  weather: "Weather", dashboard_unreachable: "Dashboard unreachable", maintenance_due: "Maintenance due",
  backup_failed: "Backup failed", cron_job_failed: "Scheduled job failed", connectivity_degraded: "Connectivity degraded",
  disk_space_low: "Disk space low", it_issue: "IT issue", system_offline: "System offline",
  crew_location_stale: "Crew location stale", crew_off_site: "Crew off site",
};

type InboxItem = {
  id: string;
  source: "alert" | "notification";
  title: string;
  severity: "critical" | "info";
  timestamp: string;
  action_url: string | null;
};

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function registerInboxRoutes(router: Router): void {
  router.get("/api/v1/dashboard/inbox", async (req, res) => {
    try {
      await requireStaffRole(req);
      const limit = getQueryInt(req, "limit", 50);

      const [openAlerts, { items: pendingNotifications }] = await Promise.all([
        listAlerts({ resolved: false }),
        listNotifications({ limit: 200, offset: 0, acknowledged: false }),
      ]);

      // A notification's own source_id points at the alert that raised
      // it (the only path that creates one today -- see notifications.ts's
      // createNotificationForAlert), so its link is resolved the same
      // way as the alert's own -- fetched fresh rather than assumed
      // still open, since a notification can outlive its alert's
      // resolution.
      const notificationLinks = await Promise.all(
        pendingNotifications.map((n) => (n.source_type === "alert" && n.source_id ? getAlert(n.source_id) : Promise.resolve(null))),
      );

      const items: InboxItem[] = [
        ...openAlerts.map((a): InboxItem => ({
          id: `alert:${a.id}`,
          source: "alert",
          title: `${ALERT_TYPE_LABELS[a.type]} alert`,
          severity: a.severity === "critical" ? "critical" : "info",
          timestamp: toIso(a.raised_at),
          action_url: alertLinkForType(a.type),
        })),
        ...pendingNotifications.map((n, i): InboxItem => ({
          id: `notification:${n.id}`,
          source: "notification",
          title: n.message,
          severity: n.priority === "critical" ? "critical" : "info",
          timestamp: toIso(n.created_at),
          action_url: notificationLinks[i] ? alertLinkForType(notificationLinks[i]!.type) : null,
        })),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

      sendJson(res, 200, {
        items: items.slice(0, limit),
        total: items.length,
        unresolved_alerts_count: openAlerts.length,
        unacknowledged_notifications_count: pendingNotifications.length,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/dashboard/inbox/:id/acknowledge", async (req, res, { id }) => {
    try {
      const user = await requireStaffRole(req);
      const [source, realId] = id.split(":");

      if (source === "alert" && realId) {
        const result = await resolveAlert(realId, { userId: user.userId });
        if (!result.ok) {
          sendJson(res, 404, { detail: result.reason === "already_resolved" ? "Already resolved" : "Not found" });
          return;
        }
        sendJson(res, 200, { id, resolved: true });
        return;
      }
      if (source === "notification" && realId) {
        const result = await acknowledgeNotification(realId, { userId: user.userId });
        if (!result.ok) {
          sendJson(res, 404, { detail: result.reason === "already_acknowledged" ? "Already acknowledged" : "Not found" });
          return;
        }
        sendJson(res, 200, { id, resolved: true });
        return;
      }
      sendJson(res, 404, { detail: "Not found" });
    } catch (err) {
      sendError(res, err);
    }
  });
}
