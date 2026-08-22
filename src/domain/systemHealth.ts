// Re-expressed from v1's system self-monitoring logic -- requirements
// baseline, not copied code. These are a genuinely different category
// from the field-ops checks in exceptions.ts: not a Postgres comparison
// on a tick, but the ingestion points a deployment's own infra scripts
// (a host-side heartbeat, a nightly backup job, a dashboard health ping)
// would call. Building those scripts themselves is Phase 3/deployment
// scope, not this slice -- what's built here is the real, callable
// mechanism they'd call into.
import { pool } from "../db/pool.js";
import { raiseAlert, type RaiseAlertResult } from "./alerts.js";
import { getNotificationSettings } from "./notificationSettings.js";

// No real backing row for these two -- same as v1, which uses fixed
// sentinel UUIDs purely so alerts' dedup has something stable to match
// against for a tableless, ongoing condition.
const CONNECTIVITY_SENTINEL_ID = "00000000-0000-0000-0000-000000000001";
const DISK_SPACE_SENTINEL_ID = "00000000-0000-0000-0000-000000000002";

async function getSystemStatus(): Promise<{ id: string; backup_last_success_at: string | null; dashboard_last_reachable_at: string | null }> {
  const result = await pool.query("SELECT * FROM system_status LIMIT 1");
  return result.rows[0];
}

// Explicit success/failure report from a nightly backup job. Success
// resets the clock and raises nothing; checkBackupStale (called from the
// periodic worker, see exceptions.ts) is what catches the job never
// running at all, which this alone can't detect.
export async function reportBackupStatus(success: boolean): Promise<RaiseAlertResult | null> {
  const status = await getSystemStatus();
  if (success) {
    await pool.query("UPDATE system_status SET backup_last_success_at = now(), updated_at = now() WHERE id = $1", [status.id]);
    return null;
  }
  const settings = await getNotificationSettings();
  return raiseAlert({
    type: "backup_failed",
    relatedRecordId: status.id,
    summary: "Nightly backup failed",
    recipientRolesOverride: settings.it_escalation_roles,
  });
}

// Fires when the backup job hasn't reported success in over 30 hours --
// catches a cron job that never ran at all, not just one that ran and
// failed (that's reportBackupStatus's job).
export async function checkBackupStale(): Promise<RaiseAlertResult | null> {
  const status = await getSystemStatus();
  const stale = !status.backup_last_success_at || new Date(status.backup_last_success_at).getTime() < Date.now() - 30 * 60 * 60 * 1000;
  if (!stale) return null;
  const settings = await getNotificationSettings();
  return raiseAlert({
    type: "backup_failed",
    relatedRecordId: status.id,
    summary: "Backup has not reported success in over 30 hours",
    recipientRolesOverride: settings.it_escalation_roles,
  });
}

export async function reportDashboardHealth(reachable: boolean): Promise<RaiseAlertResult | null> {
  const status = await getSystemStatus();
  if (reachable) {
    await pool.query("UPDATE system_status SET dashboard_last_reachable_at = now(), updated_at = now() WHERE id = $1", [status.id]);
    return null;
  }
  const settings = await getNotificationSettings();
  return raiseAlert({
    type: "dashboard_unreachable",
    relatedRecordId: status.id,
    summary: "Dashboard is unreachable",
    recipientRolesOverride: settings.it_escalation_roles,
  });
}

// Never auto-resolves even though a later healthy heartbeat could
// technically clear it -- deliberate, same as v1: a human should confirm
// recovery, not have the system quietly mark its own infra healthy
// unwatched.
export async function reportConnectivityHealth(degraded: boolean): Promise<RaiseAlertResult | null> {
  if (!degraded) return null;
  const settings = await getNotificationSettings();
  return raiseAlert({
    type: "connectivity_degraded",
    relatedRecordId: CONNECTIVITY_SENTINEL_ID,
    summary: "Host connectivity check failed",
    recipientRolesOverride: settings.it_escalation_roles,
  });
}

export async function reportDiskHealth(low: boolean): Promise<RaiseAlertResult | null> {
  if (!low) return null;
  const settings = await getNotificationSettings();
  return raiseAlert({
    type: "disk_space_low",
    relatedRecordId: DISK_SPACE_SENTINEL_ID,
    summary: "Host disk space is low",
    recipientRolesOverride: settings.it_escalation_roles,
  });
}

// Crew-initiated, freeform -- no relatedRecordId, so no dedup, matching
// v1 (every report creates its own row).
export async function reportItIssue(summary: string): Promise<RaiseAlertResult> {
  const settings = await getNotificationSettings();
  return raiseAlert({ type: "it_issue", summary, recipientRolesOverride: settings.it_escalation_roles });
}

export async function reportCronFailure(jobName: string): Promise<RaiseAlertResult> {
  const settings = await getNotificationSettings();
  return raiseAlert({
    type: "cron_job_failed",
    summary: `Cron job failed: ${jobName}`,
    recipientRolesOverride: settings.it_escalation_roles,
  });
}

// The one alert type that structurally can never be raised live -- if the
// backend/Postgres itself is down, nothing here can run. A host-side
// heartbeat notices the outage, messages WhatsApp directly (bypassing
// this system entirely), then backfills this as a purely historical
// record once recovery is confirmed -- both timestamps set at once, never
// an "open" system_offline alert.
export async function reportOfflineRecovery(offlineSince: Date, recoveredAt: Date): Promise<{ id: string }> {
  const result = await pool.query(
    `INSERT INTO alerts (type, severity, raised_at, resolved_at) VALUES ('system_offline', 'critical', $1, $2) RETURNING id`,
    [offlineSince, recoveredAt],
  );
  return result.rows[0];
}
