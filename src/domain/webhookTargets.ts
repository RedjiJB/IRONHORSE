// Restoring the vendored "Notification Webhooks" admin page for real: a
// registered outbound HTTP endpoint plus an actual dispatcher, not just
// a CRUD form nothing reads. Hooked into notifications.ts's
// createNotificationForAlert -- the one choke point every notification
// already passes through -- so every future alert/notification source
// gets webhook delivery for free, without touching this file again.
import { createHmac, randomUUID } from "node:crypto";
import { pool } from "../db/pool.js";

export type WebhookTarget = {
  id: string;
  name: string;
  url: string;
  event_filter: string;
  secret: string | null;
  active: boolean;
  last_status: number | null;
  last_attempt_at: string | null;
  failure_count: number;
  created_at: string;
  updated_at: string;
};

export async function registerWebhookTarget(args: {
  name: string;
  url: string;
  eventFilter?: string;
  secret?: string | null;
  active?: boolean;
}): Promise<WebhookTarget> {
  const result = await pool.query(
    `INSERT INTO webhook_targets (name, url, event_filter, secret, active)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [args.name, args.url, args.eventFilter ?? "*", args.secret ?? null, args.active ?? true],
  );
  return result.rows[0] as WebhookTarget;
}

export async function listWebhookTargets(): Promise<WebhookTarget[]> {
  const result = await pool.query("SELECT * FROM webhook_targets ORDER BY created_at DESC");
  return result.rows as WebhookTarget[];
}

export async function toggleWebhookTarget(id: string, active: boolean): Promise<WebhookTarget | null> {
  const result = await pool.query(
    "UPDATE webhook_targets SET active = $2, updated_at = now() WHERE id = $1 RETURNING *",
    [id, active],
  );
  return (result.rows[0] as WebhookTarget) ?? null;
}

export async function deleteWebhookTarget(id: string): Promise<boolean> {
  const result = await pool.query("DELETE FROM webhook_targets WHERE id = $1", [id]);
  return (result.rowCount ?? 0) > 0;
}

function matchesFilter(eventFilter: string, eventType: string): boolean {
  if (eventFilter.trim() === "*") return true;
  return eventFilter.split(",").map((s) => s.trim()).includes(eventType);
}

// Fire-and-forget: a slow or dead endpoint must never block alert/
// notification creation, so failures here are recorded on the target
// row, never thrown back to the caller. A short timeout (5s) keeps a
// hung endpoint from accumulating in-flight requests indefinitely.
export async function dispatchToWebhooks(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const targets = await pool.query("SELECT * FROM webhook_targets WHERE active = true");
  const body = JSON.stringify({ event: eventType, id: randomUUID(), timestamp: new Date().toISOString(), data: payload });

  await Promise.all(
    (targets.rows as WebhookTarget[])
      .filter((t) => matchesFilter(t.event_filter, eventType))
      .map(async (target) => {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (target.secret) {
          headers["x-webhook-signature"] = createHmac("sha256", target.secret).update(body).digest("hex");
        }
        let status: number | null = null;
        try {
          const res = await fetch(target.url, { method: "POST", headers, body, signal: AbortSignal.timeout(5000) });
          status = res.status;
        } catch {
          status = null;
        }
        const ok = status !== null && status >= 200 && status < 300;
        await pool.query(
          `UPDATE webhook_targets SET last_status = $2, last_attempt_at = now(), failure_count = ${ok ? "0" : "failure_count + 1"} WHERE id = $1`,
          [target.id, status],
        );
      }),
  );
}
