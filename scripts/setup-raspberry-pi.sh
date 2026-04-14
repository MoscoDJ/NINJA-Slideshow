#!/bin/bash
set -e

# NINJA Slideshow — Raspberry Pi Minimal Kiosk Setup
# Boots directly to X11 + Chromium, no desktop environment.
# Run on a fresh Raspberry Pi OS (64-bit, Lite or Desktop)
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
echo "[1/6] Updating system..."
sudo apt-get update && sudo apt-get upgrade -y

# --- 2. Install minimal X11 + Chromium (no desktop) ---
echo "[2/6] Installing minimal kiosk packages..."
sudo apt-get install -y \
  xserver-xorg x11-xserver-utils xinit \
  unclutter \
  --no-install-recommends

# Install chromium (package name varies by distro)
sudo apt-get install -y chromium 2>/dev/null || \
sudo apt-get install -y chromium-browser 2>/dev/null || {
  echo "ERROR: Could not install Chromium. Install manually:"
  echo "  sudo apt-get install -y chromium"
  exit 1
}

# --- 3. Create kiosk startup script ---
echo "[3/6] Creating kiosk script..."
mkdir -p "$HOME/.config/ninja-slideshow"

cat > "$HOME/.config/ninja-slideshow/kiosk.sh" << KIOSK
#!/bin/bash

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Force full resolution on HDMI
xrandr --output HDMI-1 --mode 1920x1080 --rate 60 2>/dev/null || \\
xrandr --output HDMI-2 --mode 1920x1080 --rate 60 2>/dev/null || true
sleep 2

# Hide mouse cursor
unclutter -idle 0 -root &

# Launch Chromium in kiosk mode (binary name varies by distro)
CHROMIUM=\$(command -v chromium-browser || command -v chromium)
\$CHROMIUM \\
  --kiosk \\
  --noerrdialogs \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-restore-session-state \\
  --disable-translate \\
  --disable-features=TranslateUI,Translate \\
  --disable-popup-blocking \\
  --disable-component-update \\
  --check-for-update-interval=31536000 \\
  --autoplay-policy=no-user-gesture-required \\
  --start-fullscreen \\
  --incognito \\
  --no-first-run \\
  --disable-pinch \\
  --overscroll-history-navigation=0 \\
  --lang=es \\
  --window-size=1920,1080 \\
  --window-position=0,0 \\
  "$SERVER_URL"
KIOSK

chmod +x "$HOME/.config/ninja-slideshow/kiosk.sh"

# --- 4. Create .xinitrc (X11 starts only Chromium, no desktop) ---
echo "[4/6] Configuring minimal X11..."

cat > "$HOME/.xinitrc" << 'XINIT'
#!/bin/bash
exec /bin/bash $HOME/.config/ninja-slideshow/kiosk.sh
XINIT

chmod +x "$HOME/.xinitrc"

# --- 5. Auto-start X11 on login (no desktop manager) ---
echo "[5/6] Configuring auto-start..."

# Add startx to .bash_profile so X11 launches on console login
if ! grep -q 'startx' "$HOME/.bash_profile" 2>/dev/null; then
  cat >> "$HOME/.bash_profile" << 'PROFILE'

# Auto-start NINJA Slideshow kiosk
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ]; then
  startx -- -nocursor 2>/dev/null
fi
PROFILE
fi

# --- 6. Set boot to console auto-login (no desktop) ---
echo "[6/6] Setting boot to console auto-login..."
sudo raspi-config nonint do_boot_behaviour B2 2>/dev/null || {
  echo "  Could not set auto-login automatically."
  echo "  Run: sudo raspi-config > System Options > Boot > Console Autologin"
}

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  Server URL: $SERVER_URL"
echo "  Boot mode:  Console auto-login → X11 → Chromium kiosk"
echo "  No desktop environment loaded."
echo ""
echo "  To change URL later, edit:"
echo "    $HOME/.config/ninja-slideshow/kiosk.sh"
echo ""
echo "  To start now:  startx"
echo "  Or reboot:     sudo reboot"
echo ""
echo "  To access the terminal while kiosk is running:"
echo "    Press Ctrl+Alt+F2 for a second console"
echo "    Press Ctrl+Alt+F1 to go back to the kiosk"
echo ""
