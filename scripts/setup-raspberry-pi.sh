#!/bin/bash
set -e

# NINJA Slideshow — Raspberry Pi Kiosk Setup
# Launches Chromium in fullscreen kiosk mode pointing to the slideshow.
# Run on a fresh Raspberry Pi OS (64-bit, Desktop)
# Usage: bash setup-raspberry-pi.sh <SERVER_URL>
#
# Example: bash setup-raspberry-pi.sh https://your-domain.com

SERVER_URL="${1:-}"

if [ -z "$SERVER_URL" ]; then
  echo "Usage: bash setup-raspberry-pi.sh <SERVER_URL>"
  echo "Example: bash setup-raspberry-pi.sh https://your-domain.com"
  exit 1
fi

echo "============================================"
echo "  NINJA Slideshow — Raspberry Pi Setup"
echo "  Server: $SERVER_URL"
echo "============================================"
echo ""

# --- 1. System update ---
echo "[1/5] Updating system..."
sudo apt-get update && sudo apt-get upgrade -y

# --- 2. Install Chromium + tools ---
echo "[2/5] Installing dependencies..."
sudo apt-get install -y chromium-browser unclutter xdotool

# --- 3. Create kiosk startup script ---
echo "[3/5] Creating kiosk script..."
mkdir -p "$HOME/.config/ninja-slideshow"

cat > "$HOME/.config/ninja-slideshow/kiosk.sh" << KIOSK
#!/bin/bash

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Hide mouse cursor after 3 seconds
unclutter -idle 3 -root &

# Wait for desktop to be ready
sleep 5

# Launch Chromium in kiosk mode
chromium-browser \\
  --kiosk \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-restore-session-state \\
  --disable-features=TranslateUI \\
  --check-for-update-interval=31536000 \\
  --autoplay-policy=no-user-gesture-required \\
  --start-fullscreen \\
  --incognito \\
  "$SERVER_URL" &
KIOSK

chmod +x "$HOME/.config/ninja-slideshow/kiosk.sh"

# --- 4. Auto-start on boot ---
echo "[4/5] Configuring auto-start..."
mkdir -p "$HOME/.config/autostart"

cat > "$HOME/.config/autostart/ninja-slideshow.desktop" << DESKTOP
[Desktop Entry]
Type=Application
Name=NINJA Slideshow
Exec=$HOME/.config/ninja-slideshow/kiosk.sh
X-GNOME-Autostart-enabled=true
DESKTOP

# Also add to LXDE autostart if present
if [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then
  if ! grep -q 'ninja-slideshow' /etc/xdg/lxsession/LXDE-pi/autostart; then
    echo "@$HOME/.config/ninja-slideshow/kiosk.sh" | sudo tee -a /etc/xdg/lxsession/LXDE-pi/autostart > /dev/null
  fi
fi

# Disable screen blanking system-wide
if [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then
  if ! grep -q 'xset s off' /etc/xdg/lxsession/LXDE-pi/autostart; then
    sudo tee -a /etc/xdg/lxsession/LXDE-pi/autostart > /dev/null << 'EOF'
@xset s off
@xset -dpms
@xset s noblank
EOF
  fi
fi

# --- 5. Enable auto-login ---
echo "[5/5] Enabling desktop auto-login..."
sudo raspi-config nonint do_boot_behaviour B4 2>/dev/null || echo "  Set auto-login manually: sudo raspi-config > System > Boot > Desktop Autologin"

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Server URL: $SERVER_URL"
echo "  To change URL later, edit:"
echo "    $HOME/.config/ninja-slideshow/kiosk.sh"
echo ""
echo "  To start now:  bash $HOME/.config/ninja-slideshow/kiosk.sh"
echo "  Or reboot:     sudo reboot"
echo ""
