#!/bin/bash
# Periodic self-monitoring heartbeat -- the other half of wiring the
# systemHealth MCP tools to something real (report_backup_status is
# handled separately, in backup-db.sh's own EXIT trap). Runs three
# independent checks; one failing doesn't block the others.
set -uo pipefail

source /home/ubuntu/ops-scripts/mcp-call.sh

DISK_THRESHOLD_PERCENT=85

# --- dashboard reachability ---
if curl -sS --max-time 10 -o /dev/null -w '%{http_code}' https://dashboard.sodboysltd.org | grep -q '^200$'; then
  mcp_call /home/ubuntu/.ops-credentials/report_dashboard_health.jwt report_dashboard_health '{"reachable": true}' >/dev/null
else
  mcp_call /home/ubuntu/.ops-credentials/report_dashboard_health.jwt report_dashboard_health '{"reachable": false}' >/dev/null
fi

# --- outbound connectivity (this box's own ability to reach the
# external services it actually depends on -- Open-Meteo, already a
# real dependency, not an arbitrary ping target) ---
if curl -sS --max-time 10 -o /dev/null https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&forecast_days=1; then
  mcp_call /home/ubuntu/.ops-credentials/report_connectivity_health.jwt report_connectivity_health '{"degraded": false}' >/dev/null
else
  mcp_call /home/ubuntu/.ops-credentials/report_connectivity_health.jwt report_connectivity_health '{"degraded": true}' >/dev/null
fi

# --- disk space ---
disk_used_percent=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if [ "$disk_used_percent" -ge "$DISK_THRESHOLD_PERCENT" ]; then
  mcp_call /home/ubuntu/.ops-credentials/report_disk_health.jwt report_disk_health '{"low": true}' >/dev/null
else
  mcp_call /home/ubuntu/.ops-credentials/report_disk_health.jwt report_disk_health '{"low": false}' >/dev/null
fi
