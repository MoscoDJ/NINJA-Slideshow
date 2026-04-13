# NINJA Slideshow - LG webOS App

Native webOS app for LG Smart TVs. Runs the slideshow as a dedicated app
instead of through the browser, which solves the memory/freezing issues
with long-running video playback.

## Why a native app instead of the browser?

LG's built-in browser shares memory with all open tabs and system processes.
Video elements leak decoded frame buffers that the WebKit garbage collector
doesn't reclaim, causing the page to freeze after extended use. A native
webOS app gets its own dedicated process with more memory, and this version
additionally:

- Explicitly releases video buffers between slides (`removeAttribute("src")` + `load()`)
- Creates/destroys DOM elements instead of reusing them
- Auto-reloads every 3 complete loops to reclaim any accumulated leaks
- Falls back to HTTP polling if Socket.IO disconnects
- Disables the TV's screensaver via webOS Luna API

## Prerequisites

Install the webOS CLI tools (ares-cli):

```bash
npm install -g @webos-tools/cli
```

Enable **Developer Mode** on the LG TV:
1. Open the LG Content Store on the TV
2. Search for and install "Developer Mode"
3. Open the app and sign in with your LG developer account
4. Enable Developer Mode and note the TV's IP address

## Setup the TV as a target

```bash
ares-setup-device
# Select "add" and enter:
#   Name: lgtv
#   IP: <TV's IP>
#   Port: 9922
#   Username: prisoner
```

Get the passphrase from the Developer Mode app on the TV, then:

```bash
ares-novacom --device lgtv --getkey
# Enter the passphrase shown on the TV
```

## Package and install

```bash
cd webos_app

# Package the app into an IPK
ares-package .

# Install on the TV
ares-install --device lgtv com.ninja.slideshow_1.0.0_all.ipk

# Launch
ares-launch --device lgtv com.ninja.slideshow
```

## Configuration

The server URL is hardcoded in `index.html` at the top of the script:

```javascript
var SERVER_URL = "https://slideshow.ninja.com.mx";
```

Change it there before packaging if needed.

## Icons

Replace `icon.png` (80x80) and `largeIcon.png` (130x130) with your
branding before packaging. Placeholder files must exist for packaging
to succeed — create them with any image editor or:

```bash
# Generate placeholder icons (requires ImageMagick)
convert -size 80x80 xc:black -fill red -gravity center -pointsize 40 -annotate 0 "N" icon.png
convert -size 130x130 xc:black -fill red -gravity center -pointsize 60 -annotate 0 "N" largeIcon.png
```

## Updating

To push a new version, increment the version in `appinfo.json`,
re-package, and re-install. The slideshow content and order are
managed from the admin panel — no app update needed for content changes.
