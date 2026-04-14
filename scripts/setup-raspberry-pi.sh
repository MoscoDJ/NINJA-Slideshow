#!/bin/bash
set -e

# NINJA Slideshow — Raspberry Pi Setup Script
# Run on a fresh Raspberry Pi OS (64-bit, Desktop)
# Usage: bash setup-raspberry-pi.sh

REPO_URL="https://github.com/MoscoDJ/NINJA-Slideshow.git"
INSTALL_DIR="/opt/ninja-slideshow"
APP_DIR="$HOME/ninja-slideshow"

echo "============================================"
echo "  NINJA Slideshow — Raspberry Pi Setup"
echo "============================================"
echo ""

# --- 1. System update ---
echo "[1/7] Updating system..."
sudo apt-get update && sudo apt-get upgrade -y

# --- 2. Install build dependencies ---
echo "[2/7] Installing build dependencies..."
sudo apt-get install -y \
  git curl unzip xz-utils wget \
  clang lld llvm cmake ninja-build pkg-config \
  libgtk-3-dev liblzma-dev libstdc++-12-dev \
  libmpv-dev \
  mesa-utils

# --- 3. Install Flutter SDK ---
echo "[3/7] Installing Flutter SDK..."
if [ -d "$HOME/flutter" ]; then
  echo "  Flutter directory exists, updating..."
  cd "$HOME/flutter" && git pull
else
  git clone https://github.com/flutter/flutter.git -b stable --depth 1 "$HOME/flutter"
fi

export PATH="$HOME/flutter/bin:$PATH"

if ! grep -q 'flutter/bin' "$HOME/.bashrc"; then
  echo 'export PATH="$HOME/flutter/bin:$PATH"' >> "$HOME/.bashrc"
fi

echo "  Running flutter doctor..."
flutter doctor
flutter config --enable-linux-desktop

# --- 4. Clone repo and build ---
echo "[4/7] Cloning repository..."
if [ -d "$APP_DIR" ]; then
  echo "  Directory exists, pulling latest..."
  cd "$APP_DIR" && git pull
else
  git clone "$REPO_URL" "$APP_DIR"
fi

echo "[5/7] Building Flutter app..."
cd "$APP_DIR/flutter_client"
flutter pub get
flutter build linux --release

# --- 5. Install the built app ---
echo "[6/7] Installing to $INSTALL_DIR..."
sudo mkdir -p "$INSTALL_DIR"
sudo cp -r build/linux/arm64/release/bundle/* "$INSTALL_DIR/"
sudo chmod +x "$INSTALL_DIR/ninja_slideshow"

# --- 6. Setup systemd service + auto-start ---
echo "[7/7] Configuring auto-start..."

sudo tee /etc/systemd/system/ninja-slideshow.service > /dev/null << EOF
[Unit]
Description=NINJA Slideshow
After=graphical-session.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=$USER
Environment=DISPLAY=:0
Environment=XDG_RUNTIME_DIR=/run/user/$(id -u)
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/ninja_slideshow
Restart=always
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ninja-slideshow

# Disable screen blanking
if [ -f /etc/xdg/lxsession/LXDE-pi/autostart ]; then
  if ! grep -q 'xset s off' /etc/xdg/lxsession/LXDE-pi/autostart; then
    sudo tee -a /etc/xdg/lxsession/LXDE-pi/autostart > /dev/null << 'EOF'
@xset s off
@xset -dpms
@xset s noblank
EOF
  fi
fi

echo ""
echo "============================================"
echo "  Setup complete!"
echo "============================================"
echo ""
echo "  To start now:  sudo systemctl start ninja-slideshow"
echo "  To run manually: $INSTALL_DIR/ninja_slideshow"
echo ""
echo "  On first launch, configure the server URL"
echo "  (press Esc or S to open settings anytime)"
echo ""
echo "  Reboot recommended: sudo reboot"
echo ""
