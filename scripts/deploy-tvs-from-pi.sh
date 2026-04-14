#!/bin/bash

# NINJA Slideshow — Deploy to LG TVs from Raspberry Pi
# Schedule with cron: crontab -e → 0 */12 * * * /path/to/deploy-tvs-from-pi.sh
#
# Prerequisites (one time):
#   curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
#   sudo apt-get install -y nodejs
#   npm install -g @webos-tools/cli

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
WEBOS_DIR="$PROJECT_DIR/webos_app"
APP_ID="com.ninja.slideshow"
LOG_FILE="$SCRIPT_DIR/deploy-tv-log.txt"

# ============================================================
#  CONFIGURATION — Add your TVs here
# ============================================================

declare -A TVS
TVS[lgtv-sala]="192.168.10.161|159FED"
TVS[lgtv-lobby]="192.168.10.162|XXXXXX"
TVS[lgtv-oficina]="192.168.10.163|XXXXXX"

# ============================================================

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

deploy_lg() {
  local name="$1"
  local ip="$2"
  local pass="$3"

  log "--- $name ($ip) ---"

  # Register device
  ares-setup-device --add "$name" \
    --info "{'host':'$ip','port':'9922','username':'prisoner'}" 2>/dev/null || true

  # Get SSH key
  log "  Getting key..."
  node -e "
const { spawn } = require('child_process');
const p = spawn('ares-novacom', ['--device', '$name', '--getkey'], { stdio: ['pipe','pipe','pipe'] });
p.stdout.on('data', d => {
  if (d.toString().includes('passphrase')) setTimeout(() => p.stdin.write('$pass\n'), 300);
});
setTimeout(() => process.exit(0), 3000);
" 2>/dev/null

  # Package
  log "  Packaging..."
  ares-package "$WEBOS_DIR" -o /tmp/ 2>/dev/null
  local ipk=$(ls -t /tmp/${APP_ID}_*.ipk 2>/dev/null | head -1)

  if [ -z "$ipk" ]; then
    log "  ERROR: IPK not found"
    return 1
  fi

  # Install & launch
  log "  Installing..."
  if ares-install --device "$name" "$ipk" 2>&1; then
    log "  Launching..."
    ares-launch --device "$name" "$APP_ID" 2>/dev/null
    log "  OK: $name deployed"
  else
    log "  ERROR: Install failed on $name"
  fi
}

# ============================================================

log "=========================================="
log "  NINJA Slideshow — TV Auto-Deploy"
log "=========================================="

for name in "${!TVS[@]}"; do
  IFS='|' read -r ip pass <<< "${TVS[$name]}"
  deploy_lg "$name" "$ip" "$pass" || true
done

log "=========================================="
log "  Deploy complete"
log "=========================================="
