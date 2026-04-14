#!/bin/bash
set -e

# NINJA Slideshow — Deploy to LG webOS TV
# Usage: bash deploy-lgtv.sh [TV_IP] [PASSPHRASE]
#
# Prerequisites: Node 20, @webos-tools/cli installed globally
# First time: set up Developer Mode on the TV

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TV_IP="${1:-192.168.10.161}"
PASSPHRASE="${2:-159FED}"
DEVICE_NAME="lgtv"
APP_ID="com.ninja.slideshow"

echo "==================================="
echo "  NINJA Slideshow → LG TV Deploy"
echo "==================================="
echo "  TV IP: $TV_IP"
echo ""

# Use Node 20 if nvm is available (webOS CLI needs it)
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  nvm use 20 2>/dev/null || { echo "Installing Node 20..."; nvm install 20; }
fi

# Check ares-cli
if ! command -v ares-install &> /dev/null; then
  echo "Installing @webos-tools/cli..."
  npm install -g @webos-tools/cli
fi

# Register device (ignore if already exists)
ares-setup-device --add "$DEVICE_NAME" \
  --info "{'host':'$TV_IP','port':'9922','username':'prisoner'}" 2>/dev/null || true

# Get SSH key
echo "Getting SSH key (passphrase: $PASSPHRASE)..."
node -e "
const { spawn } = require('child_process');
const p = spawn('ares-novacom', ['--device', '$DEVICE_NAME', '--getkey'], { stdio: ['pipe', 'pipe', 'pipe'] });
p.stdout.on('data', d => {
  if (d.toString().includes('passphrase')) setTimeout(() => p.stdin.write('$PASSPHRASE\n'), 300);
});
p.on('close', () => {});
setTimeout(() => process.exit(0), 3000);
"

# Package the app
echo "Packaging..."
cd "$PROJECT_DIR/webos_app"
ares-package . -o /tmp/ 2>/dev/null
IPK=$(ls -t /tmp/${APP_ID}_*.ipk | head -1)

# Install and launch
echo "Installing on TV..."
ares-install --device "$DEVICE_NAME" "$IPK"

echo "Launching..."
ares-launch --device "$DEVICE_NAME" "$APP_ID"

echo ""
echo "==================================="
echo "  Done! App running on LG TV."
echo "==================================="
