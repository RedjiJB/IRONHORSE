# Server-side ops scripts

## Facade/MCP box (`40.233.126.23`)

Deployed at `~/backup-db.sh` and `~/ops-scripts/`, with the `.service`/`.timer` units at `/etc/systemd/system/`. Deployment is manual (`scp` + `systemctl daemon-reload`), matching this project's existing deploy flow — not synced automatically on push.

- **backup-db.sh** — nightly `pg_dump` to Object Storage (instance-principal auth). Reports success/failure via `report_backup_status` on an `EXIT` trap.
- **ops-heartbeat.sh** — every 15 minutes: dashboard reachability, outbound connectivity, disk space. Reports via `report_dashboard_health`/`report_connectivity_health`/`report_disk_health`.
- **mcp-call.sh** — shared helper both scripts source: calls one MCP tool against the local MCP transport (`127.0.0.1:8090`) with a `credentialJwt` read from a file under `~/.ops-credentials/` (one JWT per specific `report_*` capability, tier 4, minted via `npm run bootstrap:ops-infra-agent` — narrowly scoped per capability, not a wildcard grant).

Credentials themselves are never committed — `~/.ops-credentials/*.jwt` on the box only, `chmod 600`.

## OpenClaw box (`40.233.78.15`)

- **external-uptime-check.sh** — every 5 minutes, from a genuinely separate box: curls the facade box's public `dashboard.sodboysltd.org` and `id.sodboysltd.org` endpoints, appends OK/FAIL to `~/external-uptime.log`. Exists because `ops-heartbeat.sh` (running *on* the facade box) can't detect that box being completely unreachable — this is the check that actually covers that case. No WhatsApp push yet (channel isn't paired); a human checks the log directly until that's wired up.
