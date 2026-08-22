// Task #156 slice C. Maps this backend's flat notifications row onto the
// vendored frontend's richer i18n-shaped Notification type (confirmed by
// direct code reading of NotificationsPage.tsx) -- title_key/body_key
// don't correspond to anything in this system (no templating layer, just
// a pre-formatted message string, same as v1), so they're synthesized
// generic keys relying on the frontend's own defaultValue fallback to
// title_default/body_default for actual display text.
//
// Deliberately NOT built here (see docs/ARCHITECTURE.md Task #156 scope
// table): per-user notification preferences (GET/POST .../preferences/,
// GET .../event-types/) -- no backing concept exists (notification_settings
// is one global singleton row, not per-user opt-in), DELETE (no domain
// delete concept for what's effectively an audit log) is a no-op 200
// rather than real deletion, and the real-time push channel
// (.../notifications/ws/) -- confirmed by reading useNotificationsWebSocket.ts
// that this is explicitly best-effort on the frontend side (a missing
// endpoint just leaves the bell on its 30s polling cadence, never
// crashes the UI), so it's real-time push infra deferred to Phase 3
// (WhatsApp/OpenClaw wiring), not a gap this slice needs to close.
import type { Router } from "../router.js";
import { getQueryInt, getQueryParam, sendError, sendJson } from "../context.js";
import { requireStaffRole } from "../auth.js";
import {
  acknowledgeNotification,
  countUnacknowledgedNotifications,
  listNotifications,
  type Notification,
} from "../../domain/notifications.js";

function toFrontendShape(n: Notification) {
  return {
    id: n.id,
    notification_type: n.source_type,
    icon_category: n.priority === "critical" ? "error" : "info",
    title_key: `notifications.generic.${n.source_type}`,
    title_default: n.source_type.charAt(0).toUpperCase() + n.source_type.slice(1),
    body_key: null,
    body_default: n.message,
    body_context: {},
    action_url: null,
    is_read: n.acknowledged_at !== null,
    created_at: n.created_at,
  };
}

export function registerNotificationRoutes(router: Router): void {
  router.get("/api/v1/notifications", async (req, res) => {
    try {
      await requireStaffRole(req);
      const limit = getQueryInt(req, "limit", 50);
      const offset = getQueryInt(req, "offset", 0);
      const isReadParam = getQueryParam(req, "is_read");
      const acknowledged = isReadParam === undefined ? undefined : isReadParam === "true";

      const { items, total } = await listNotifications({ limit, offset, acknowledged });
      const unreadCount = await countUnacknowledgedNotifications();
      sendJson(res, 200, { items: items.map(toFrontendShape), total, offset, limit, unread_count: unreadCount });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Separate from the list envelope's own unread_count field -- the
  // header bell polls this independently every 30s (confirmed by reading
  // NotificationBell.tsx), regardless of whether the notifications list
  // page itself is even open.
  router.get("/api/v1/notifications/unread-count", async (req, res) => {
    try {
      await requireStaffRole(req);
      const count = await countUnacknowledgedNotifications();
      sendJson(res, 200, { count });
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/notifications/:id/read", async (req, res, { id }) => {
    try {
      const user = await requireStaffRole(req);
      const result = await acknowledgeNotification(id, { userId: user.userId });
      if (!result.ok) {
        sendJson(res, result.reason === "not_found" ? 404 : 400, { detail: result.reason });
        return;
      }
      sendJson(res, 200, {});
    } catch (err) {
      sendError(res, err);
    }
  });

  router.post("/api/v1/notifications/read-all", async (req, res) => {
    try {
      const user = await requireStaffRole(req);
      const { items } = await listNotifications({ limit: 10_000, offset: 0, acknowledged: false });
      for (const item of items) {
        await acknowledgeNotification(item.id, { userId: user.userId });
      }
      sendJson(res, 200, {});
    } catch (err) {
      sendError(res, err);
    }
  });

  // No real delete concept for what's effectively an audit log --
  // accept the call, do nothing, same shape the frontend expects on
  // success.
  router.delete("/api/v1/notifications/:id", async (req, res) => {
    try {
      await requireStaffRole(req);
      sendJson(res, 200, {});
    } catch (err) {
      sendError(res, err);
    }
  });
}
