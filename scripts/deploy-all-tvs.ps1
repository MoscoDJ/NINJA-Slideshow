# NINJA Slideshow — Auto-deploy to all Smart TVs
# Run manually or schedule with Windows Task Scheduler (every 24h)
#
# Prerequisites:
#   - Node.js 20.x installed (https://nodejs.org)
#   - npm install -g @webos-tools/cli   (for LG)
#   - Tizen Studio CLI in PATH          (for Samsung, optional)
#
# Setup Task Scheduler:
#   1. Open Task Scheduler
#   2. Create Basic Task > "NINJA TV Deploy"
#   3. Trigger: Daily, repeat every 24 hours
#   4. Action: Start a program
#      Program: powershell.exe
#      Arguments: -ExecutionPolicy Bypass -File "C:\path\to\deploy-all-tvs.ps1"
#   5. Check "Run whether user is logged on or not"

# ============================================================
#  CONFIGURATION — Edit this section with your TVs
# ============================================================

$LG_TVs = @(
    @{ Name = "lgtv-sala";     IP = "192.168.10.161"; Passphrase = "159FED" },
    @{ Name = "lgtv-lobby";    IP = "192.168.10.162"; Passphrase = "XXXXXX" },
    @{ Name = "lgtv-oficina";  IP = "192.168.10.163"; Passphrase = "XXXXXX" }
)

$Samsung_TVs = @(
    # @{ Name = "samsung-recepcion"; IP = "192.168.10.170"; CertProfile = "ninja-cert" }
)

$APP_ID_LG      = "com.ninja.slideshow"
$APP_ID_SAMSUNG  = "ninjSlide.NINJASlideshow"
$SCRIPT_DIR      = Split-Path -Parent $MyInvocation.MyCommand.Path
$PROJECT_DIR     = Split-Path -Parent $SCRIPT_DIR
$WEBOS_DIR       = Join-Path $PROJECT_DIR "webos_app"
$TIZEN_DIR       = Join-Path $PROJECT_DIR "tizen_app"
$TEMP_DIR        = $env:TEMP

$LOG_FILE = Join-Path $SCRIPT_DIR "deploy-log.txt"

function Log($msg) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $msg"
    Write-Host $line
    Add-Content -Path $LOG_FILE -Value $line
}

# ============================================================
#  LG webOS TVs
# ============================================================

function Deploy-LG($tv) {
    $name = $tv.Name
    $ip   = $tv.IP
    $pass = $tv.Passphrase

    Log "--- LG: $name ($ip) ---"

    try {
        # Register device
        & ares-setup-device --add $name --info "{'host':'$ip','port':'9922','username':'prisoner'}" 2>$null
    } catch {}

    # Get SSH key
    Log "  Getting SSH key..."
    $keyScript = @"
const { spawn } = require('child_process');
const p = spawn('ares-novacom', ['--device', '$name', '--getkey'], { stdio: ['pipe','pipe','pipe'] });
p.stdout.on('data', d => {
  if (d.toString().includes('passphrase')) setTimeout(() => p.stdin.write('$pass\n'), 300);
});
p.on('close', () => {});
setTimeout(() => process.exit(0), 3000);
"@
    $keyScript | node -e -

    # Package
    Log "  Packaging..."
    Push-Location $WEBOS_DIR
    & ares-package . -o $TEMP_DIR 2>$null
    Pop-Location

    $ipk = Get-ChildItem "$TEMP_DIR\${APP_ID_LG}_*.ipk" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $ipk) {
        Log "  ERROR: IPK not found"
        return
    }

    # Install
    Log "  Installing..."
    $result = & ares-install --device $name $ipk.FullName 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "  ERROR: Install failed — $result"
        return
    }

    # Launch
    Log "  Launching..."
    & ares-launch --device $name $APP_ID_LG 2>&1 | Out-Null

    Log "  OK: $name deployed successfully"
}

# ============================================================
#  Samsung Tizen TVs
# ============================================================

function Deploy-Samsung($tv) {
    $name    = $tv.Name
    $ip      = $tv.IP
    $profile = $tv.CertProfile

    Log "--- Samsung: $name ($ip) ---"

    # Connect
    Log "  Connecting..."
    & sdb connect "${ip}:26101" 2>&1 | Out-Null

    $devices = & sdb devices 2>&1
    $serial = ($devices | Select-String $ip | ForEach-Object { ($_ -split '\s+')[0] })

    if (-not $serial) {
        Log "  ERROR: Could not find device serial for $ip"
        return
    }

    # Package
    Log "  Packaging..."
    Push-Location $TIZEN_DIR
    & tizen package -t wgt -s $profile -- . 2>&1 | Out-Null
    Pop-Location

    $wgt = Get-ChildItem "$TIZEN_DIR\*.wgt" | Sort-Object LastWriteTime -Descending | Select-Object -First 1

    if (-not $wgt) {
        Log "  ERROR: WGT not found"
        return
    }

    # Install
    Log "  Installing..."
    $result = & tizen install -n $wgt.Name -t $serial 2>&1
    if ($LASTEXITCODE -ne 0) {
        Log "  ERROR: Install failed — $result"
        return
    }

    # Launch
    Log "  Launching..."
    & tizen run -p $APP_ID_SAMSUNG -t $serial 2>&1 | Out-Null

    Log "  OK: $name deployed successfully"
}

# ============================================================
#  MAIN
# ============================================================

Log "=========================================="
Log "  NINJA Slideshow — TV Auto-Deploy"
Log "=========================================="

foreach ($tv in $LG_TVs) {
    try { Deploy-LG $tv } catch { Log "  ERROR on $($tv.Name): $_" }
}

foreach ($tv in $Samsung_TVs) {
    try { Deploy-Samsung $tv } catch { Log "  ERROR on $($tv.Name): $_" }
}

Log "=========================================="
Log "  Deploy complete"
Log "=========================================="
