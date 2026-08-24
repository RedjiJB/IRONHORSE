# Durable, unattended retry for the OpenClaw Ampere A1 instance launch --
# runs every 25 min via Windows Task Scheduler (survives a Claude Code
# session ending, unlike an in-session wakeup loop). Idempotent: exits
# immediately if already done or an instance already exists. Only does
# mechanical, safely-automatable setup (launch + base Node/OpenClaw
# install) -- the actual OpenClaw config, the auth-bridge plugin, and
# WhatsApp re-pairing are deliberately NOT done here; those need a human
# in the loop (WhatsApp pairing literally cannot be unattended) and real
# design/testing, not a blind unattended script.

$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false
$oci = "$env:USERPROFILE\lib\oracle-cli\Scripts\oci.exe"
$logFile = "$PSScriptRoot\openclaw-provision.log"
$doneMarker = "$PSScriptRoot\openclaw-provision.done"
$tenancy = "ocid1.tenancy.oc1..aaaaaaaap5txsfzfrd7wmvwimih7dsqbxu3hxmmz62iygr7zpj4kw4t2ieja"
$ad = "PIvv:CA-TORONTO-1-AD-1"
$image = "ocid1.image.oc1.ca-toronto-1.aaaaaaaa2o5hlxuly5jlhqzpnwx47e3u4fpy5wejass7tci5ik5ahnp47nga"
$subnet = "ocid1.subnet.oc1.ca-toronto-1.aaaaaaaaz3xe3g6hhymmtbyh7srcwulxbzjdeupc42rtrwucxqpyvcmy4fuq"
$sshKeyPub = "$env:USERPROFILE\.ssh\dcentral_openclaw_oracle.pub"
$sshKeyPriv = "$env:USERPROFILE\.ssh\dcentral_openclaw_oracle"
$shapeConfigFile = "$PSScriptRoot\shape-config.json"
Set-Content -Path $shapeConfigFile -Value '{"ocpus": 2, "memoryInGBs": 12}' -NoNewline

function Log($msg) {
    $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
    Add-Content -Path $logFile -Value $line
}

if (Test-Path $doneMarker) {
    exit 0
}

# Idempotent: if an instance already exists (e.g. a prior run of this
# script succeeded but didn't get to write the marker), don't launch a
# second one -- just pick up where it left off.
$existingJson = & $oci compute instance list --compartment-id $tenancy --display-name "dcentral-openclaw" --lifecycle-state RUNNING --query "data[0].id" --raw-output 2>$null
$instanceId = $null
if ($LASTEXITCODE -eq 0 -and $existingJson -and $existingJson -ne "null") {
    $instanceId = $existingJson
    Log "Found existing running instance $instanceId, skipping launch."
} else {
    Log "Attempting launch..."
    $launchOut = & $oci compute instance launch `
        --availability-domain $ad `
        --compartment-id $tenancy `
        --display-name "dcentral-openclaw" `
        --shape "VM.Standard.A1.Flex" `
        --shape-config "file://$shapeConfigFile" `
        --image-id $image `
        --subnet-id $subnet `
        --assign-public-ip true `
        --ssh-authorized-keys-file $sshKeyPub `
        --query "data.id" --raw-output 2>&1

    if ($LASTEXITCODE -ne 0) {
        if ($launchOut -match "Out of host capacity") {
            Log "Still out of capacity. Will retry next run."
        } else {
            Log "Launch failed with an unexpected error: $launchOut"
        }
        exit 0
    }
    $instanceId = $launchOut
    Log "Launch succeeded: $instanceId. Waiting for RUNNING state..."
    & $oci compute instance action --instance-id $instanceId --action START --wait-for-state RUNNING --max-wait-seconds 300 2>&1 | Out-Null
}

# Get the public IP.
$publicIp = & $oci compute instance list-vnics --instance-id $instanceId --query "data[0].\"public-ip\"" --raw-output 2>&1
if (-not $publicIp -or $publicIp -eq "null") {
    Log "Instance running but no public IP yet -- will retry next run."
    exit 0
}
Log "Public IP: $publicIp"

# Wait for SSH to actually be reachable (boot + cloud-init takes a
# couple minutes even after the instance is RUNNING).
$sshReady = $false
for ($i = 0; $i -lt 10; $i++) {
    $probe = & ssh -i $sshKeyPriv -o StrictHostKeyChecking=accept-new -o ConnectTimeout=8 -o BatchMode=yes "ubuntu@$publicIp" "echo ok" 2>&1
    if ($probe -match "ok") { $sshReady = $true; break }
    Start-Sleep -Seconds 20
}
if (-not $sshReady) {
    Log "SSH not reachable yet after waiting -- will retry next run."
    exit 0
}
Log "SSH reachable."

# Base, mechanical setup only -- Node.js + the openclaw binary. No
# openclaw.json, no plugin, no pairing: those need a human.
$setupScript = @'
set -e
sudo apt-get update -qq
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - >/tmp/nodesource.log 2>&1
sudo apt-get install -y -qq nodejs
sudo npm install -g openclaw >/tmp/openclaw-install.log 2>&1
node --version
openclaw --version
'@
$setupResult = & ssh -i $sshKeyPriv -o BatchMode=yes "ubuntu@$publicIp" $setupScript 2>&1
Log "Setup output: $setupResult"

if ($setupResult -match "OpenClaw") {
    Set-Content -Path $doneMarker -Value "Provisioned $instanceId at $publicIp on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'). Node/OpenClaw binary installed. Config, auth-bridge plugin, and WhatsApp pairing still need to be done interactively."
    Log "DONE. Base provisioning complete for $publicIp."
} else {
    Log "Setup ran but openclaw --version didn't confirm success -- check manually."
}
