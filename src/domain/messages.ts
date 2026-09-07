// Push-to-guard messaging/broadcast (FEATURES.md §3). Direct
// person-to-person messages and site broadcasts share one table, one row
// per recipient -- see 0011_messages.sql for why. Sending/broadcasting is
// an MCP-tool/façade-layer capability check (supervisor-only), not
// enforced here -- contactSupervisor below is the guard-facing direction
// this module's send/broadcast mechanics were always meant to serve too.
import { pool } from "../db/pool.js";
import { listActiveSupervisorsAndAdmins, listGuardsWithOnDutyStatus } from "./guards.js";

export type Message = {
  id: string;
  sender_id: string;
  recipient_id: string;
  site_id: string | null;
  body: string;
  created_at: string;
  read_at: string | null;
};

export async function sendMessage(args: { senderId: string; recipientId: string; body: string; siteId?: string | null }): Promise<Message> {
  const result = await pool.query(
    `INSERT INTO messages (sender_id, recipient_id, site_id, body) VALUES ($1, $2, $3, $4) RETURNING *`,
    [args.senderId, args.recipientId, args.siteId ?? null, args.body],
  );
  return result.rows[0] as Message;
}

// Broadcasts to every guard currently on duty at the given site (based on
// today's timeclock state, same "on duty" definition listGuardsWithOnDutyStatus
// already uses for the live-roster view) -- not every guard ever assigned
// there. A supervisor broadcasting "leaving early tonight, cover the gate"
// only reaches guards actually working right now, which is the real use
// case; reaching guards not on shift would need a different, explicitly
// scheduled-recipients design, not this one.
export async function broadcastToSite(args: { senderId: string; siteId: string; body: string }): Promise<Message[]> {
  const onDuty = await listGuardsWithOnDutyStatus({ active: true });
  const recipients = onDuty.filter((g) => g.on_duty_site_id === args.siteId && g.id !== args.senderId);
  const sent: Message[] = [];
  for (const guard of recipients) {
    sent.push(await sendMessage({ senderId: args.senderId, recipientId: guard.id, body: args.body, siteId: args.siteId }));
  }
  return sent;
}

// Guard-facing "contact supervisor" button (FEATURES.md §2, Phase 2) --
// the reuse this module's own header comment anticipated. Pages every
// active supervisor/admin system-wide, same targeting
// duress.ts's triggerDuressAlert uses (DOMAIN-DESIGN.md §3's documented
// simplification: broader net than "supervisors overseeing this site"
// until site-level supervisor assignment exists). Unlike duress, this is
// an ordinary message, not a forced-critical incident -- a guard reaching
// out for help or to report something isn't automatically a silent alarm.
export async function contactSupervisor(args: { guardId: string; siteId?: string; body: string }): Promise<Message[]> {
  const supervisors = await listActiveSupervisorsAndAdmins();
  const sent: Message[] = [];
  for (const supervisor of supervisors) {
    sent.push(await sendMessage({ senderId: args.guardId, recipientId: supervisor.id, siteId: args.siteId ?? null, body: args.body }));
  }
  return sent;
}

export async function listInbox(guardId: string, filter?: { unreadOnly?: boolean }): Promise<Message[]> {
  if (filter?.unreadOnly) {
    const result = await pool.query(
      "SELECT * FROM messages WHERE recipient_id = $1 AND read_at IS NULL ORDER BY created_at DESC",
      [guardId],
    );
    return result.rows as Message[];
  }
  const result = await pool.query("SELECT * FROM messages WHERE recipient_id = $1 ORDER BY created_at DESC", [guardId]);
  return result.rows as Message[];
}

export type MarkReadResult = { ok: true; message: Message } | { ok: false; reason: "not_found" | "not_recipient" };

// A guard can only mark their own received message read -- guardId is the
// authenticated caller, checked against recipient_id, not trusted from the
// request body.
export async function markMessageRead(messageId: string, guardId: string): Promise<MarkReadResult> {
  const current = await pool.query("SELECT * FROM messages WHERE id = $1", [messageId]);
  const message = current.rows[0] as Message | undefined;
  if (!message) return { ok: false, reason: "not_found" };
  if (message.recipient_id !== guardId) return { ok: false, reason: "not_recipient" };
  if (message.read_at) return { ok: true, message };

  const result = await pool.query("UPDATE messages SET read_at = now() WHERE id = $1 RETURNING *", [messageId]);
  return { ok: true, message: result.rows[0] as Message };
}
