// Re-expressed from v1's exceptions worker (backend/src/workers/
// exceptions.ts) -- requirements baseline, not copied code. Each check
// function is a plain Postgres comparison against domain tables that
// already exist from earlier slices; raiseAlert's own dedup (see
// src/domain/alerts.ts) means calling a check function repeatedly is
// always safe -- it only ever creates a new alert the first time a given
// condition is caught, same as v1's periodic tick.
//
// STALE_TELEMETRY_MINUTES (60) and VEHICLE_DARK_HOURS (3) stay hardcoded
// constants, not notification_settings columns -- same as v1, on the
// reasoning that they're detection sensitivity, not a policy call.
import { pool } from "../db/pool.js";
import { haversineDistanceMeters } from "./geo.js";
import { raiseAlert } from "./alerts.js";
import { getNotificationSettings, type NotificationSettings } from "./notificationSettings.js";
import { checkBackupStale } from "./systemHealth.js";

const STALE_TELEMETRY_MINUTES = 60;
const VEHICLE_DARK_HOURS = 3;

export async function checkOverdueCheckouts(): Promise<void> {
  const result = await pool.query(
    `SELECT c.id, a.current_site_id, a.name AS asset_name
     FROM checkouts c JOIN assets a ON a.id = c.asset_id
     WHERE c.checked_in_at IS NULL AND c.expected_return_at IS NOT NULL AND c.expected_return_at < now()`,
  );
  for (const row of result.rows) {
    await raiseAlert({
      type: "overdue",
      relatedRecordId: row.id,
      siteId: row.current_site_id ?? undefined,
      summary: `Checkout of ${row.asset_name} is overdue`,
    });
  }
}

export async function checkStalledOrders(settings: NotificationSettings): Promise<void> {
  const result = await pool.query(
    `SELECT id, site_id FROM orders WHERE status = 'requested' AND created_at < now() - ($1 || ' hours')::interval`,
    [settings.order_stall_hours],
  );
  for (const row of result.rows) {
    await raiseAlert({ type: "order_stalled", relatedRecordId: row.id, siteId: row.site_id ?? undefined, summary: "Order stalled in 'requested' status" });
  }
}

// A rough "nothing is moving" proxy pending a real task/job concept --
// same honest limitation v1 documents.
export async function checkIdleCrew(settings: NotificationSettings): Promise<void> {
  const result = await pool.query(
    `WITH latest_events AS (
       SELECT DISTINCT ON (crew_member_id) crew_member_id, event_type, "timestamp", site_id
       FROM timeclock_entries ORDER BY crew_member_id, "timestamp" DESC
     )
     SELECT crew_member_id, site_id FROM latest_events le
     WHERE le.event_type IN ('in', 'break_end')
       AND le."timestamp" < now() - ($1 || ' hours')::interval
       AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.requester_id = le.crew_member_id AND o.created_at >= le."timestamp")
       AND NOT EXISTS (SELECT 1 FROM checkouts c WHERE c.checked_out_by = le.crew_member_id AND c.checked_out_at >= le."timestamp")`,
    [settings.idle_hours],
  );
  for (const row of result.rows) {
    await raiseAlert({ type: "idle", relatedRecordId: row.crew_member_id, siteId: row.site_id ?? undefined, summary: "Crew member idle -- no order or checkout activity since clock-in" });
  }
}

// Confirmed shift whose start time has passed with no clock-in -- an
// explicitly simplified stand-in for real travel-time/ETA tracking, same
// as v1 (no site-to-site expected-duration data exists in this schema).
export async function checkDelayedArrivals(settings: NotificationSettings): Promise<void> {
  const result = await pool.query(
    `SELECT sh.id, sh.site_id FROM shifts sh
     WHERE sh.date = CURRENT_DATE AND sh.status = 'confirmed' AND sh.start_time IS NOT NULL
       AND (sh.date + sh.start_time)::timestamptz < now() - ($1 || ' minutes')::interval
       AND NOT EXISTS (
         SELECT 1 FROM timeclock_entries te
         WHERE te.crew_member_id = sh.crew_member_id AND te.event_type = 'in' AND te."timestamp"::date = CURRENT_DATE
       )`,
    [settings.delay_buffer_minutes],
  );
  for (const row of result.rows) {
    await raiseAlert({ type: "delay", relatedRecordId: row.id, siteId: row.site_id, summary: "Shift start time passed with no clock-in" });
  }
}

// Circular geofences only -- polygon sites aren't checked, same
// documented gap v1 carries.
export async function checkWrongSite(): Promise<void> {
  const result = await pool.query(
    `SELECT v.id AS vehicle_id, s.id AS site_id, s.center_lat, s.center_lng, s.geofence_radius_m, vt.lat, vt.lng
     FROM vehicles v
     JOIN shifts sh ON sh.crew_member_id = v.assigned_crew_id AND sh.date = CURRENT_DATE AND sh.status = 'confirmed'
     JOIN sites s ON s.id = sh.site_id
     JOIN LATERAL (SELECT lat, lng, "timestamp" FROM vehicle_telemetry WHERE vehicle_id = v.id ORDER BY "timestamp" DESC LIMIT 1) vt ON true
     WHERE v.assigned_crew_id IS NOT NULL
       AND s.center_lat IS NOT NULL AND s.center_lng IS NOT NULL AND s.geofence_radius_m IS NOT NULL
       AND vt."timestamp" >= now() - (${STALE_TELEMETRY_MINUTES} || ' minutes')::interval`,
  );
  for (const row of result.rows) {
    const distance = haversineDistanceMeters(row.lat, row.lng, row.center_lat, row.center_lng);
    if (distance > row.geofence_radius_m) {
      await raiseAlert({ type: "wrong_site", relatedRecordId: row.vehicle_id, siteId: row.site_id, summary: "Vehicle is outside its expected site's geofence" });
    }
  }
}

// Checked before crew_off_site -- a stale point isn't evidence of a live
// off-site condition, same reasoning v1 gives.
export async function checkCrewLocationStale(settings: NotificationSettings): Promise<void> {
  const result = await pool.query(
    `SELECT sh.crew_member_id, sh.site_id FROM shifts sh
     JOIN LATERAL (SELECT "timestamp" FROM crew_telemetry WHERE crew_member_id = sh.crew_member_id ORDER BY "timestamp" DESC LIMIT 1) ct ON true
     WHERE sh.date = CURRENT_DATE AND sh.status = 'confirmed'
       AND ct."timestamp" < now() - ($1 || ' minutes')::interval`,
    [settings.crew_location_stale_minutes],
  );
  for (const row of result.rows) {
    await raiseAlert({
      type: "crew_location_stale",
      relatedRecordId: row.crew_member_id,
      siteId: row.site_id,
      summary: "Crew member's last known location is stale",
      recipientRolesOverride: settings.it_escalation_roles,
    });
  }
}

export async function checkCrewOffSite(settings: NotificationSettings): Promise<void> {
  const result = await pool.query(
    `SELECT sh.crew_member_id, sh.site_id, s.center_lat, s.center_lng, s.geofence_radius_m, ct.lat, ct.lng
     FROM shifts sh
     JOIN sites s ON s.id = sh.site_id
     JOIN LATERAL (SELECT lat, lng, "timestamp" FROM crew_telemetry WHERE crew_member_id = sh.crew_member_id ORDER BY "timestamp" DESC LIMIT 1) ct ON true
     WHERE sh.date = CURRENT_DATE AND sh.status = 'confirmed'
       AND s.center_lat IS NOT NULL AND s.center_lng IS NOT NULL AND s.geofence_radius_m IS NOT NULL
       AND ct."timestamp" >= now() - ($1 || ' minutes')::interval`,
    [settings.crew_location_stale_minutes],
  );
  for (const row of result.rows) {
    const distance = haversineDistanceMeters(row.lat, row.lng, row.center_lat, row.center_lng);
    if (distance > row.geofence_radius_m) {
      await raiseAlert({
        type: "crew_off_site",
        relatedRecordId: row.crew_member_id,
        siteId: row.site_id,
        summary: "Crew member's last known location is outside their shift's site geofence",
        recipientRolesOverride: settings.it_escalation_roles,
      });
    }
  }
}

// Fires only when a vehicle was actively reporting and has since gone
// dark -- not the same as "never reports at all" (a vehicle with zero
// telemetry ever is excluded by the LATERAL join requiring >=1 point).
export async function checkVehicleDark(settings: NotificationSettings): Promise<void> {
  const result = await pool.query(
    `SELECT v.id AS vehicle_id, sh.site_id FROM vehicles v
     JOIN shifts sh ON sh.crew_member_id = v.assigned_crew_id AND sh.date = CURRENT_DATE AND sh.status = 'confirmed'
     JOIN LATERAL (SELECT "timestamp" FROM vehicle_telemetry WHERE vehicle_id = v.id ORDER BY "timestamp" DESC LIMIT 1) vt ON true
     WHERE v.assigned_crew_id IS NOT NULL
       AND vt."timestamp" < now() - interval '${VEHICLE_DARK_HOURS} hours'
       AND EXISTS (
         SELECT 1 FROM vehicle_telemetry vt2
         WHERE vt2.vehicle_id = v.id AND vt2."timestamp" < vt."timestamp" AND vt2."timestamp" >= vt."timestamp" - interval '24 hours'
       )`,
  );
  for (const row of result.rows) {
    await raiseAlert({
      type: "vehicle_dark",
      relatedRecordId: row.vehicle_id,
      siteId: row.site_id,
      summary: "Vehicle has gone dark -- was reporting, has since stopped",
      severityOverride: settings.vehicle_dark_critical ? "critical" : undefined,
    });
  }
}

// Only checks loadout_items with an asset_id -- consumables have no
// per-departure "still out" signal the way checkouts gives assets, same
// documented exclusion as v1. Fires one alert per job listing every
// missing item, not one alert per missing item.
export async function checkLoadoutGap(): Promise<void> {
  const result = await pool.query(
    `SELECT j.id AS job_id, j.site_id, a.name AS asset_name
     FROM jobs j
     JOIN shifts sh ON sh.job_id = j.id AND sh.status = 'confirmed'
     JOIN loadouts lo ON lo.job_type_id = j.job_type_id
     JOIN loadout_items li ON li.loadout_id = lo.id AND li.asset_id IS NOT NULL
     JOIN assets a ON a.id = li.asset_id
     WHERE j.date = CURRENT_DATE AND j.status != 'complete' AND j.job_type_id IS NOT NULL
       AND (j.date + sh.start_time)::timestamptz < now()
       AND NOT EXISTS (
         SELECT 1 FROM checkouts c
         WHERE c.asset_id = li.asset_id AND c.checked_in_at IS NULL
           AND c.checked_out_by IN (SELECT crew_member_id FROM shifts WHERE job_id = j.id)
       )`,
  );
  const byJob = new Map<string, { siteId: string; missing: string[] }>();
  for (const row of result.rows) {
    const entry: { siteId: string; missing: string[] } = byJob.get(row.job_id) ?? { siteId: row.site_id, missing: [] };
    entry.missing.push(row.asset_name);
    byJob.set(row.job_id, entry);
  }
  for (const [jobId, entry] of byJob) {
    await raiseAlert({ type: "loadout_gap", relatedRecordId: jobId, siteId: entry.siteId, summary: `Missing loadout items: ${entry.missing.join(", ")}` });
  }
}

// Calendar-interval only, same as v1 -- no odometer/usage/hours tracking.
export async function checkMaintenanceDue(): Promise<void> {
  const result = await pool.query(
    `SELECT id, current_site_id FROM assets
     WHERE service_interval_days IS NOT NULL
       AND now() > COALESCE(last_serviced_at, created_at) + (service_interval_days || ' days')::interval`,
  );
  for (const row of result.rows) {
    await raiseAlert({ type: "maintenance_due", relatedRecordId: row.id, siteId: row.current_site_id ?? undefined, summary: "Asset maintenance is due" });
  }
}

export type ForecastResult = { precipitationProbabilityMax: number; windspeed10mMax: number } | null;
export type FetchForecast = (lat: number, lng: number) => Promise<ForecastResult>;

// Open-Meteo -- free, no API key, per policy/sovereignty_tiers.yaml's
// existing external_accepted decision for weather. Fails silently on any
// error/timeout so it never blocks the rest of the tick, same as v1.
export const fetchOpenMeteoForecast: FetchForecast = async (lat, lng) => {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_probability_max,windspeed_10m_max&forecast_days=1&timezone=auto`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { daily?: { precipitation_probability_max?: number[]; windspeed_10m_max?: number[] } };
    const precip = data.daily?.precipitation_probability_max?.[0];
    const wind = data.daily?.windspeed_10m_max?.[0];
    if (precip == null || wind == null) return null;
    return { precipitationProbabilityMax: precip, windspeed10mMax: wind };
  } catch {
    return null;
  }
};

// Uniquely date-scoped rather than open/resolved-scoped: any still-open
// weather alert from a prior day is auto-resolved first, then raiseAlert's
// own dedup (unresolved-only) naturally prevents re-raising today's alert
// twice. The one alert type with this self-healing daily-reset behavior.
export async function checkWeather(settings: NotificationSettings, fetchForecast: FetchForecast = fetchOpenMeteoForecast): Promise<void> {
  await pool.query(`UPDATE alerts SET resolved_at = now() WHERE type = 'weather' AND resolved_at IS NULL AND raised_at::date < CURRENT_DATE`);

  const sites = await pool.query(
    `SELECT DISTINCT s.id, s.center_lat, s.center_lng FROM sites s
     JOIN shifts sh ON sh.site_id = s.id AND sh.date = CURRENT_DATE AND sh.status = 'confirmed'
     WHERE s.type = 'job_site' AND s.center_lat IS NOT NULL AND s.center_lng IS NOT NULL`,
  );
  for (const site of sites.rows) {
    const forecast = await fetchForecast(site.center_lat, site.center_lng);
    if (!forecast) continue;
    if (forecast.precipitationProbabilityMax >= settings.rain_probability_threshold || forecast.windspeed10mMax >= settings.wind_speed_threshold_kmh) {
      await raiseAlert({
        type: "weather",
        relatedRecordId: site.id,
        siteId: site.id,
        summary: `Weather risk: ${forecast.precipitationProbabilityMax}% precipitation, ${forecast.windspeed10mMax}km/h wind`,
      });
    }
  }
}

// Runs every check in v1's documented tick order. Called on an interval
// by whatever process boots the server (see src/index.ts) -- exposed here
// as a plain callable function so tests can invoke one tick directly
// rather than waiting on a real timer.
export async function runExceptionChecks(fetchForecast?: FetchForecast): Promise<void> {
  const settings = await getNotificationSettings();
  await checkOverdueCheckouts();
  await checkStalledOrders(settings);
  await checkIdleCrew(settings);
  await checkWrongSite();
  await checkCrewLocationStale(settings);
  await checkCrewOffSite(settings);
  await checkVehicleDark(settings);
  await checkDelayedArrivals(settings);
  await checkLoadoutGap();
  await checkMaintenanceDue();
  await checkBackupStale();
  await checkWeather(settings, fetchForecast);
}

// Fires immediately on boot, then every intervalMs -- same as v1's
// setInterval-based worker running inside the same backend process (not
// a separate process, not cron). Called from the HTTP MCP transport's
// bootstrap (src/mcp/transports/http.ts), the one long-running process
// this system has today.
export function startExceptionsWorker(intervalMs: number): NodeJS.Timeout {
  runExceptionChecks().catch((err) => console.error("[exceptions] tick failed", err));
  return setInterval(() => {
    runExceptionChecks().catch((err) => console.error("[exceptions] tick failed", err));
  }, intervalMs);
}
