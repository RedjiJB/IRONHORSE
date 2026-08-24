#!/bin/bash
# Nightly dcentral-fieldops database backup. Real security-audit gap,
# fixed: this VM held the only copy of a real client's operational
# database (crew, timeclock, alerts, purchase orders, payroll) with no
# backup at all. Dumps inside the postgres container (no host-side
# pg_dump version to keep in sync), uploads to Object Storage via
# instance-principal auth (no stored credential on this box -- the VM's
# own identity, scoped by IAM policy to only this bucket), local copies
# pruned after 3 days, remote copies auto-expire after 30 via the
# bucket's own lifecycle policy (not hand-rolled deletion logic here).
#
# report_backup_status is now wired via a trap on EXIT (added once the
# systemHealth MCP tools were found to be a real ingestion point with
# nothing calling them) -- fires on both success and failure, since
# `set -e` means a failure exits before reaching a plain end-of-script
# call.
set -euo pipefail

source /home/ubuntu/ops-scripts/mcp-call.sh

report_exit_status() {
  local exit_code=$?
  if [ "$exit_code" -eq 0 ]; then
    mcp_call /home/ubuntu/.ops-credentials/report_backup_status.jwt report_backup_status '{"success": true}' >/dev/null
  else
    mcp_call /home/ubuntu/.ops-credentials/report_backup_status.jwt report_backup_status '{"success": false}' >/dev/null
  fi
}
trap report_exit_status EXIT

TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
BACKUP_DIR=/home/ubuntu/db-backups
BACKUP_FILE="dcentral_fieldops_${TIMESTAMP}.sql.gz"
OCI_BIN=/home/ubuntu/.backup-venv/bin/oci
NAMESPACE=yzkbm1fa4jcz
BUCKET=dcentral-fieldops-backups

mkdir -p "$BACKUP_DIR"

docker exec dcentral-fieldops-postgres-1 pg_dump -U dcentral dcentral_fieldops | gzip > "$BACKUP_DIR/$BACKUP_FILE"

if [ ! -s "$BACKUP_DIR/$BACKUP_FILE" ]; then
  echo "backup-db: dump produced an empty file, aborting upload" >&2
  exit 1
fi

"$OCI_BIN" os object put --auth instance_principal --namespace "$NAMESPACE" --bucket-name "$BUCKET" \
  --file "$BACKUP_DIR/$BACKUP_FILE" --name "$BACKUP_FILE" --force

find "$BACKUP_DIR" -name "dcentral_fieldops_*.sql.gz" -mtime +3 -delete

echo "backup-db: $BACKUP_FILE uploaded ($(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1))"
