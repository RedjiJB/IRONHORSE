// Re-expressed from v1's notification_settings domain logic --
// requirements baseline, not copied code. A true singleton -- exactly one
// row, seeded by migration, never re-inserted. Updates run unconditionally
// with no WHERE clause, same as v1.
import { pool } from "../db/pool.js";

export type NotificationSettings = {
  escalation_threshold_minutes: number;
  max_escalations: number;
  vehicle_dark_critical: boolean;
  critical_notification_roles: string[];
  it_escalation_roles: string[];
  order_stall_hours: number;
  idle_hours: number;
  delay_buffer_minutes: number;
  rain_probability_threshold: number;
  wind_speed_threshold_kmh: number;
  daily_overtime_hours: number;
  break_required_after_hours: number;
  crew_location_stale_minutes: number;
  updated_at: string;
};

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const result = await pool.query("SELECT * FROM notification_settings LIMIT 1");
  return result.rows[0] as NotificationSettings;
}

// Only supplied fields change -- COALESCE against the existing row, same
// partial-update shape as v1's PATCH route.
export async function updateNotificationSettings(patch: Partial<Omit<NotificationSettings, "updated_at">>): Promise<NotificationSettings> {
  const result = await pool.query(
    `UPDATE notification_settings SET
       escalation_threshold_minutes = COALESCE($1, escalation_threshold_minutes),
       max_escalations = COALESCE($2, max_escalations),
       vehicle_dark_critical = COALESCE($3, vehicle_dark_critical),
       critical_notification_roles = COALESCE($4, critical_notification_roles),
       it_escalation_roles = COALESCE($5, it_escalation_roles),
       order_stall_hours = COALESCE($6, order_stall_hours),
       idle_hours = COALESCE($7, idle_hours),
       delay_buffer_minutes = COALESCE($8, delay_buffer_minutes),
       rain_probability_threshold = COALESCE($9, rain_probability_threshold),
       wind_speed_threshold_kmh = COALESCE($10, wind_speed_threshold_kmh),
       daily_overtime_hours = COALESCE($11, daily_overtime_hours),
       break_required_after_hours = COALESCE($12, break_required_after_hours),
       crew_location_stale_minutes = COALESCE($13, crew_location_stale_minutes),
       updated_at = now()
     RETURNING *`,
    [
      patch.escalation_threshold_minutes ?? null,
      patch.max_escalations ?? null,
      patch.vehicle_dark_critical ?? null,
      patch.critical_notification_roles ?? null,
      patch.it_escalation_roles ?? null,
      patch.order_stall_hours ?? null,
      patch.idle_hours ?? null,
      patch.delay_buffer_minutes ?? null,
      patch.rain_probability_threshold ?? null,
      patch.wind_speed_threshold_kmh ?? null,
      patch.daily_overtime_hours ?? null,
      patch.break_required_after_hours ?? null,
      patch.crew_location_stale_minutes ?? null,
    ],
  );
  return result.rows[0] as NotificationSettings;
}
