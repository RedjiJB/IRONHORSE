#!/bin/bash
# Runs on the OTHER box (40.233.78.15, the OpenClaw gateway) checking
# the facade/MCP box's public endpoints -- genuinely external to what
# it's monitoring, without needing a third-party uptime service or
# account. ops-heartbeat.sh (on the facade box itself) can't detect the
# facade box being *completely* unreachable; this is the check that
# actually covers that case, from a real second vantage point.
#
# No WhatsApp push yet (channel isn't paired) -- appends a timestamped
# line to a local log so a human can check it directly. Wiring FAIL
# lines to an actual WhatsApp page is real follow-up work once pairing
# is done, not faked here.
set -uo pipefail

LOG_FILE=/home/ubuntu/external-uptime.log
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

check() {
  local name="$1"
  local url="$2"
  local code
  code=$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) OK   $name ($code)" >> "$LOG_FILE"
  else
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) FAIL $name ($code)" >> "$LOG_FILE"
  fi
}

check dashboard https://dashboard.sodboysltd.org
check mcp-server https://id.sodboysltd.org/.well-known/did.json

# Keep the log from growing forever -- at 5-minute checks this is
# ~576 lines/day; trim to the last ~30 days' worth rather than let it
# grow indefinitely. A plain line-count cap, not real rotation -- this
# is a spot-check log, not a metrics store.
tail -n 20000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
