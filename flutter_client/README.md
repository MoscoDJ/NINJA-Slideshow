# NINJA Slideshow - Flutter Client

Flutter Linux desktop app for running the NINJA Slideshow in infinite loop on a Raspberry Pi (4/5).

## Features

- Fullscreen slideshow with fade transitions
- Infinite loop playback (images + videos)
- Real-time updates via Socket.IO (content and order changes reflect immediately)
- Intelligent local cache (pre-downloads media for smooth playback)
- Configurable image display duration
- Offline resilience (continues playing cached content if network drops)
- Press **Esc** or **S** to access settings

---

## Raspberry Pi Setup From Scratch

### 1. Flash the OS

- Download **Raspberry Pi OS (64-bit, Desktop)** from https://www.raspberrypi.com/software/
- Flash to a microSD card using **Raspberry Pi Imager**
- During flashing, configure WiFi, hostname, locale, and enable SSH

### 2. First boot & system update

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo reboot
```

### 3. Install build dependencies

```bash
sudo apt-get install -y \
  git curl unzip xz-utils \
  clang cmake ninja-build pkg-config \
  libgtk-3-dev liblzma-dev libstdc++-12-dev \
  libmpv-dev \
  mesa-utils
```

### 4. Install Flutter SDK

```bash
cd ~
git clone https://github.com/flutter/flutter.git -b stable --depth 1
echo 'export PATH="$HOME/flutter/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
flutter doctor
```

Verify that `flutter doctor` shows Linux desktop as available. If it shows
"No supported devices", run:

```bash
flutter config --enable-linux-desktop
```

### 5. Clone and build the app

```bash
git clone <your-repo-url> ~/ninja-slideshow
cd ~/ninja-slideshow/flutter_client
flutter pub get
flutter build linux --release
```

Build output is at:
```
build/linux/arm64/release/bundle/
```

### 6. Install the built app

```bash
sudo mkdir -p /opt/ninja-slideshow
sudo cp -r build/linux/arm64/release/bundle/* /opt/ninja-slideshow/
sudo chmod +x /opt/ninja-slideshow/ninja_slideshow
```

### 7. Auto-start on boot (systemd + auto-login)

Enable auto-login to desktop (required for GUI apps):

```bash
sudo raspi-config
# System Options > Boot / Auto Login > Desktop Autologin
```

Create the systemd service:

```bash
sudo tee /etc/systemd/system/ninja-slideshow.service << 'EOF'
[Unit]
Description=NINJA Slideshow
After=graphical-session.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=pi
Environment=DISPLAY=:0
Environment=XDG_RUNTIME_DIR=/run/user/1000
WorkingDirectory=/opt/ninja-slideshow
ExecStart=/opt/ninja-slideshow/ninja_slideshow
Restart=always
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable ninja-slideshow
sudo systemctl start ninja-slideshow
```

### 8. Disable screen blanking

```bash
# Prevent screen from turning off
sudo tee -a /etc/xdg/lxsession/LXDE-pi/autostart << 'EOF'
@xset s off
@xset -dpms
@xset s noblank
EOF
```

### 9. First run configuration

On first launch, the app shows a configuration screen. Enter:
- **Server URL**: `https://your-domain.com`
- **Image duration**: seconds per image (default: 15)

Settings are persisted locally and survive reboots.

---

## Android TV Build (Haier, Sharp)

The Android platform is already configured with leanback support,
landscape-only orientation, immersive fullscreen, wakelock, and D-pad
navigation. Same codebase as the Linux build.

### Prerequisites

- Flutter SDK with Android toolchain configured (`flutter doctor`)
- Android SDK with API level 21+ (Android 5.0)
- Java 17

### Build the APK

```bash
cd flutter_client
flutter build apk --release
```

Output APK:
```
build/app/outputs/flutter-apk/app-release.apk
```

### Install on the TV

**Via ADB** (TV and computer on the same network):

```bash
# Enable Developer Options on the TV:
# Settings > About > Build Number (tap 7 times)
# Settings > Developer Options > USB Debugging ON
# Settings > Developer Options > Network Debugging ON (note the IP)

adb connect <TV_IP>:5555
adb install app-release.apk
```

**Via USB**: Copy the APK to a USB drive, plug into the TV, open with
a file manager app and install.

### Remote control navigation

- **D-pad arrows**: navigate between fields on the config screen
- **Select/Enter**: submit / activate focused element
- **Back**: from the slideshow, opens the settings screen

### App ID

The app is registered as `mx.com.ninja.slideshow`. Change in
`android/app/build.gradle.kts` if needed.

---

## LG webOS App

See `../webos_app/README.md` for packaging and deployment instructions.
Uses a standalone HTML/JS slideshow with aggressive memory management
to avoid the freezing issue on LG's built-in browser.

---

## Samsung Tizen App

See `../tizen_app/README.md` for packaging and deployment instructions.
Uses the same standalone HTML/JS approach as the LG version, adapted
for Tizen APIs (power management, remote back button).

---

## Platform Summary

| Platform      | Brands           | Directory        | Build output     |
|---------------|------------------|------------------|------------------|
| Linux Desktop | Raspberry Pi     | `flutter_client` | native binary    |
| Android TV    | Haier, Sharp     | `flutter_client` | APK              |
| webOS         | LG               | `webos_app`      | IPK (ares-cli)   |
| Tizen         | Samsung          | `tizen_app`      | WGT (Tizen SDK)  |
