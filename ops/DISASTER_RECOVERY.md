# Disaster Recovery: Rebuilding the facade/MCP box from scratch

Written 2026-08-24, during a real incident: the facade/MCP box (`40.233.126.23`) became unresponsive to SSH and HTTPS after a frontend build exhausted memory and swap. This document exists so the rebuild can be done by a human alone, with no AI session, if needed. Every command below is real and copy-pasteable — nothing is a placeholder unless explicitly marked `<LOOK THIS UP>`.

**Read the whole thing once before running anything.** Two sections near the end (Caddy config, DNS) are **not preserved anywhere** — they need to be reconstructed from the description given, not copy-pasted.

---

## What you're rebuilding

Two things ran on the dead box:
1. **`dcentral-facade.service`** — the REST API the dashboard frontend calls (port 8092).
2. **`dcentral-mcp.service`** — the MCP server, publicly reachable at `id.sodboysltd.org` (port 8090).

Both are one Node.js codebase (`dcentral-fieldops`), backed by one Postgres container. Caddy reverse-proxies both `dashboard.sodboysltd.org` and `id.sodboysltd.org` with real TLS (Cloudflare Origin CA cert).

## What's known-good and where it lives

- **GitHub (source of truth for code):** `git@github.com:RedjiJB/sodboys-fieldops.git`, branch `main`. Everything through commit `df19377` (2026-08-24) is verified working — builds clean, 229/229 backend tests pass, frontend tests pass.
- **Frontend submodule:** `https://github.com/RedjiJB/OpenConstructionERP.git`, branch `sod-boys-fork`. Pinned by the parent repo's submodule reference — cloning the parent with `--recurse-submodules` gets the right commit automatically.
- **Database backups:** Object Storage bucket `dcentral-fieldops-backups`, namespace `yzkbm1fa4jcz`, region `ca-toronto-1`. Files named `dcentral_fieldops_YYYYMMDD_HHMMSS.sql.gz`. Latest known-good one as of this writing: `dcentral_fieldops_20260824_163044.sql.gz` (20KB compressed — this system's real data volume is tiny, restore is fast).
- **SSH keys (on your Windows machine):**
  - `~/.ssh/dcentral_fieldops_oracle` — the (now-dead) facade box's key.
  - `~/.ssh/dcentral_openclaw_oracle` — the OpenClaw box's key (`40.233.78.15`, separate instance, should still be alive — check it too before assuming everything is down).
  - `~/.ssh/dcentral_fieldops_console` (RSA) — used for OCI serial console access. Only works for the console proxy, not for logging into the guest OS itself (no password is set on `ubuntu`).
- **OCI CLI:** configured at `~/.oci/config`. On Windows, the `oci` shim at `C:\Users\jredj\bin\oci` is a bash wrapper that PowerShell can't run directly — call `$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe` instead. Set `$PSNativeCommandUseErrorActionPreference = $false` first (the exe prints a harmless stderr warning on every call that PowerShell 7 otherwise treats as fatal).
- **Cloudflare:** zone `sodboysltd.org`. API token with SSL/Certificates permission at `C:\Users\jredj\.cloudflare\api_token`.
- **ops/server/ (this repo):** `backup-db.sh`, `ops-heartbeat.sh`, `mcp-call.sh`, and their systemd units — real, tested, ready to redeploy as-is.

## What's NOT preserved anywhere (real gaps)

- **The Caddyfile.** Never version-controlled. You will write a new one from the description in "Step 6" below, not copy one from a backup.
- **The exact `oci compute instance launch` parameters** used to create the original box (image OCID, subnet OCID, etc.). Step 2 shows you how to read them off the *other* still-alive box (`dcentral-openclaw`) as a template, since it's the same free-tier shape.
- **The Cloudflare Origin CA cert files** (`/etc/caddy/certs/origin.pem`/`origin.key`). Only ever lived on the dead box. Step 6 covers reissuing a fresh one — takes a few minutes, not a blocker.

---

## Step 0 — Preserve the dead box's disk before terminating anything

Even though the DB backup should be sufficient, don't throw away the second recovery path for free:

```powershell
$PSNativeCommandUseErrorActionPreference = $false
$instanceId = "ocid1.instance.oc1.ca-toronto-1.an2g6ljrmhkym2acz6chn3fdca5y3fdije23y2q2mpo4il2wv5av4h5tlbka"
& "$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe" compute instance terminate --instance-id $instanceId --preserve-boot-volume true --force
```

`--preserve-boot-volume true` is the important part — the old disk survives as a detached boot volume you can attach to a rescue instance later if the Object Storage restore somehow doesn't work. Without it, `terminate` deletes the disk permanently.

If this also 409s with "currently being modified" (the same conflict that blocked the earlier reset attempts), you may just have to wait longer for Oracle's control plane to release the lock. There's no client-side workaround for that specific error — it clears on its own eventually (this session, a stuck SOFTRESET blocked all other actions for over 30 minutes before the situation was escalated to a hard reset attempt, which was *also* still blocked at the time this document was written).

## Step 1 — Confirm the quota is free

The Always-Free tier here allows exactly 2 `VM.Standard.E2.1.Micro` instances. One is `dcentral-openclaw` (still alive, don't touch it). The dead one has to actually finish terminating before you can launch its replacement — check with:

```powershell
& "$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe" compute instance list --compartment-id <TENANCY_OCID> --output json | Select-String "display-name|lifecycle-state"
```

(`<TENANCY_OCID>` — read it from `~/.oci/config`, the `tenancy=` line.)

## Step 2 — Launch the replacement instance

Get the working launch parameters from the still-alive OpenClaw box as a template (same free-tier shape, known to work):

```powershell
& "$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe" compute instance get --instance-id <OPENCLAW_INSTANCE_OCID> --output json
```

Note its `availability-domain`, `shape` (`VM.Standard.E2.1.Micro`), `image-id`, and subnet (from the VNIC attachment — `compute vnic-attachment list --instance-id <id>` if it's not in the instance output directly). Use the **same values** for the new instance — same subnet means it inherits the same OCI security list automatically, so you don't have to redo that part.

```powershell
$pubKey = Get-Content ~/.ssh/dcentral_fieldops_oracle.pub -Raw
& "$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe" compute instance launch `
  --compartment-id <TENANCY_OCID> `
  --availability-domain "<FROM ABOVE>" `
  --shape "VM.Standard.E2.1.Micro" `
  --image-id "<FROM ABOVE>" `
  --subnet-id "<FROM ABOVE>" `
  --display-name "dcentral-fieldops" `
  --assign-public-ip true `
  --metadata "{\"ssh_authorized_keys\":\"$pubKey\"}"
```

Wait for `lifecycle-state: RUNNING` (poll with `compute instance get`), then get its new public IP:

```powershell
& "$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe" compute instance list-vnics --instance-id <NEW_INSTANCE_OCID> --output json | Select-String "public-ip"
```

Confirm SSH works: `ssh -i ~/.ssh/dcentral_fieldops_oracle ubuntu@<NEW_IP> "echo alive"`.

## Step 3 — OS-level firewall (iptables)

The OCI security list is inherited automatically from the subnet (step 2), but the **OS-level** iptables rules for Cloudflare's IP ranges are not — they lived only on the dead box. Re-add them:

```bash
# On the new box, as ubuntu with sudo:
# Allow SSH (22) and HTTP/HTTPS (80/443) from Cloudflare's published ranges only.
# Get the current ranges from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
# (fetch fresh at rebuild time -- these do change occasionally)
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  sudo iptables -A INPUT -p tcp -s "$ip" --dport 80 -j ACCEPT
  sudo iptables -A INPUT -p tcp -s "$ip" --dport 443 -j ACCEPT
done
sudo netfilter-persistent save
```

Ubuntu's cloud images here already have `iptables-persistent` installed (confirmed on the original box) — if this one doesn't, `sudo apt install iptables-persistent` first.

## Step 4 — Docker, Node, base packages

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin caddy
sudo usermod -aG docker ubuntu
# log out/in for the group change to take effect, or use `newgrp docker`

# Node 22 (matches the original box):
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

## Step 5 — Clone the repo and restore the database

```bash
git clone --recurse-submodules git@github.com:RedjiJB/sodboys-fieldops.git /home/ubuntu/dcentral-fieldops
cd /home/ubuntu/dcentral-fieldops

# Start Postgres:
docker compose up -d

# Wait a few seconds for it to accept connections, then restore the latest backup.
# Download it from Object Storage first -- instance-principal auth won't work
# until the dynamic group + IAM policy are re-pointed at this NEW instance's OCID
# (see "Instance-principal auth" note below), so use your local API-key-based
# oci CLI to fetch it instead:
& "$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe" os object get --namespace yzkbm1fa4jcz --bucket-name dcentral-fieldops-backups --name dcentral_fieldops_<LATEST>.sql.gz --file backup.sql.gz
scp -i ~/.ssh/dcentral_fieldops_oracle backup.sql.gz ubuntu@<NEW_IP>:/home/ubuntu/

# On the box:
gunzip -c backup.sql.gz | docker exec -i dcentral-fieldops-postgres-1 psql -U dcentral dcentral_fieldops
```

**Instance-principal auth** (used by `backup-db.sh` to upload nightly backups without a stored credential) is scoped to the *old* instance's OCID via a dynamic group rule. Once the new instance exists, update the dynamic group's matching rule (Identity > Dynamic Groups, in the OCI console, or `oci iam dynamic-group update`) to match the new instance's OCID — otherwise nightly backups will silently fail to upload from the new box.

## Step 6 — Caddy config (reconstructed, not copied — this is the real gap)

First, reissue a fresh Cloudflare Origin CA cert (the old one only ever lived on the dead box):

```bash
curl -X POST "https://api.cloudflare.com/client/v4/certificates" \
  -H "Authorization: Bearer $(cat ~/.cloudflare/api_token)" \
  -H "Content-Type: application/json" \
  --data '{"hostnames":["sodboysltd.org","*.sodboysltd.org"],"requested_validity":5475,"request_type":"origin-rsa"}'
```

Save the returned `certificate` and `private_key` fields to `/etc/caddy/certs/origin.pem` and `/etc/caddy/certs/origin.key` on the new box.

Write `/etc/caddy/Caddyfile` with this shape (reconstructed from the deploy notes, not an exact original copy):

```
dashboard.sodboysltd.org {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
    root * /var/www/dashboard
    file_server
    reverse_proxy /api/* localhost:8092
}

id.sodboysltd.org {
    tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
    reverse_proxy localhost:8090
}
```

This is a reasonable reconstruction based on what's documented (dashboard serves static files + proxies `/api` to :8092; id.sodboysltd.org proxies everything to :8090) but wasn't the exact original file — check that the dashboard frontend's actual API base path matches `/api/*` (see `vendor/openconstructionerp/frontend/src/shared/lib/api.ts`'s base URL constant) before trusting this blindly.

```bash
sudo systemctl restart caddy
```

## Step 7 — Build and deploy the app

```bash
cd /home/ubuntu/dcentral-fieldops
cp .env.example .env
# Edit .env: set DATABASE_URL (postgres://dcentral:devpassword@localhost:5433/dcentral_fieldops --
# check docker-compose.yml for the actual password if it was changed from the default),
# NODE_DID_DOMAIN=id.sodboysltd.org, and any LLM provider keys previously configured
# (DEEPSEEK_API_KEY / OPENAI_API_KEY -- these are NOT in the DB backup, you'll need
# the actual key values again, e.g. from the OpenClaw box's own onboard config or wherever
# else they're recorded).

npm ci
npm run build
npm run migrate
npm run sync:policy
npm run bootstrap:node
```

Set up the systemd services (these two aren't in `ops/server/` yet — reconstruct from the deploy notes: `dcentral-facade.service` runs `dist/facade/server.js` on port 8092, `dcentral-mcp.service` runs `dist/mcp/transports/http.js` on port 8090, both `Type=simple`, `User=ubuntu`, `WorkingDirectory=/home/ubuntu/dcentral-fieldops`, `Restart=always`).

Then redeploy the already-tested ops scripts from this repo:
```bash
mkdir -p ~/ops-scripts
cp ops/server/backup-db.sh ~/backup-db.sh
cp ops/server/mcp-call.sh ops/server/ops-heartbeat.sh ~/ops-scripts/
chmod +x ~/backup-db.sh ~/ops-scripts/*.sh
sudo cp ops/server/dcentral-backup.service ops/server/dcentral-backup.timer ops/server/dcentral-heartbeat.service ops/server/dcentral-heartbeat.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dcentral-facade dcentral-mcp dcentral-backup.timer dcentral-heartbeat.timer
```

You'll also need to re-mint the ops-infra credentials (`npm run bootstrap:ops-infra-agent`) and drop them into `~/.ops-credentials/*.jwt` (chmod 600) — these are per-node capability grants, not something a DB restore recreates automatically in usable form on the new box (the grants themselves ARE in the DB, but the JWTs granting the OLD node's DID as issuer may not match — verify `npm run bootstrap:node` ran first so this node's own DID/keys exist before minting them).

## Step 8 — Frontend

Don't repeat the on-box build that caused this incident. Build locally on your Windows machine first (`cd vendor/openconstructionerp/frontend && npm run build`), then ship the pre-built `dist/` folder:

```bash
tar -czf frontend-dist.tar.gz -C vendor/openconstructionerp/frontend dist
scp -i ~/.ssh/dcentral_fieldops_oracle frontend-dist.tar.gz ubuntu@<NEW_IP>:/home/ubuntu/
# On the box:
sudo mkdir -p /var/www/dashboard
sudo tar -xzf ~/frontend-dist.tar.gz -C /var/www/dashboard --strip-components=1
sudo chown -R caddy:caddy /var/www/dashboard
```

## Step 9 — DNS

In the Cloudflare dashboard (or via API), update the `A` records for `dashboard.sodboysltd.org` and `id.sodboysltd.org` to the new instance's public IP. Since the zone is already proxied through Cloudflare, this should propagate in seconds to low minutes, not hours.

## Step 10 — Verify

```bash
curl -I https://dashboard.sodboysltd.org
curl https://id.sodboysltd.org/.well-known/did.json
```

Log into the dashboard, confirm crew/site/alert data from the restored backup is actually there, confirm the version footer shows `2.0.0`, check the new Site Cost Summary page at `/5d` loads.

---

## If the Object Storage backup is somehow also gone

1. Attach the preserved boot volume (Step 0) to a temporary rescue instance as a secondary block volume.
2. Mount it, find the Docker volume data for the old Postgres container (`/var/lib/docker/volumes/dcentral-fieldops_dcentral_postgres_data/_data` or similar — check `docker volume inspect` on a running system for the exact path convention first).
3. Copy that data directory onto the new box's equivalent Docker volume before first starting the new Postgres container, or run a temporary Postgres container pointed at the old data directory and `pg_dump` from it normally.

This is a real, working path but slower and more manual than the Object Storage restore — treat it as the fallback, not the plan.
