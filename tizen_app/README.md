# NINJA Slideshow - Samsung Tizen App

Native Tizen web app for Samsung Smart TVs.

## Prerequisites

1. Install **Tizen Studio** from https://developer.tizen.org/development/tizen-studio/download
2. Install the TV extensions via Tizen Package Manager
3. Enable **Developer Mode** on the Samsung TV:
   - Go to Apps, press 1-2-3-4-5 on the remote
   - Enable Developer Mode, enter your PC's IP
   - Reboot the TV

## Connect to the TV

In Tizen Studio:
1. Open **Device Manager**
2. Click **Remote Device Manager** > **Scan**
3. Toggle the connection ON for your TV

Or via CLI:
```bash
sdb connect <TV_IP>:26101
```

## Build and install

```bash
cd tizen_app

# Create the package
tizen package -t wgt -s <your-signing-profile> -- .

# Install on the TV
tizen install -n NINJASlideshow.wgt -t <device-serial>

# Run
tizen run -p ninjSlide.NINJASlideshow -t <device-serial>
```

## Configuration

The server URL is set at the top of `index.html`:

```javascript
var SERVER_URL = "https://your-domain.com";
```

## Icon

Replace `icon.png` (117x117) before packaging.
