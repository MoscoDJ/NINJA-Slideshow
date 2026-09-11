#!/usr/bin/env python3
"""Samsung TV power control via Smart TV API + WOL"""
import asyncio, json, ssl, socket, sys, os, time

if len(sys.argv) < 4:
    print("Uso: samsung-power.py <IP> <MAC> on|off")
    sys.exit(2)

TV_IP, TV_MAC, ACTION = sys.argv[1], sys.argv[2], sys.argv[3]

# Broadcast derivado de la IP: la version de la Pi lo tenia fijo en
# 192.168.10.255 y la Samsung ya vive en otra subred.
BROADCAST = TV_IP.rsplit(".", 1)[0] + ".255"
TOKEN_FILE = os.path.expanduser("~/.config/ninja-slideshow/samsung-token.json")

try:
    import websockets
except ImportError:
    sys.exit("Falta el modulo websockets. Instalar con: pip install websockets")

def load_token():
    try:
        with open(TOKEN_FILE) as f:
            return json.load(f).get(TV_IP, "")
    except:
        return ""

def save_token(token):
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    tokens = {}
    try:
        with open(TOKEN_FILE) as f:
            tokens = json.load(f)
    except:
        pass
    tokens[TV_IP] = token
    with open(TOKEN_FILE, "w") as f:
        json.dump(tokens, f)

def send_wol():
    mac = TV_MAC.replace(":", "")
    data = b"\xff" * 6 + (bytes.fromhex(mac)) * 16
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    s.sendto(data, (BROADCAST, 9))
    s.close()
    print("WOL sent to " + TV_MAC)

async def samsung_power_off():
    token = load_token()
    uri = "wss://" + TV_IP + ":8002/api/v2/channels/samsung.remote.control"
    if token:
        uri += "?token=" + token

    ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE

    try:
        async with websockets.connect(uri, ssl=ssl_ctx, open_timeout=5, close_timeout=3) as ws:
            resp = await asyncio.wait_for(ws.recv(), timeout=10)
            data = json.loads(resp)

            # Save token if provided
            if "data" in data and "token" in data.get("data", {}):
                save_token(data["data"]["token"])
                print("Token saved")

            if data.get("event") == "ms.channel.connect":
                # Send power off key
                cmd = json.dumps({
                    "method": "ms.remote.control",
                    "params": {
                        "Cmd": "Click",
                        "DataOfCmd": "KEY_POWER",
                        "Option": "false",
                        "TypeOfRemote": "SendRemoteKey"
                    }
                })
                await ws.send(cmd)
                await asyncio.sleep(1)
                print("Power OFF sent")
                return True
            else:
                print("Unexpected response: " + json.dumps(data)[:100])
                return False
    except Exception as e:
        print("Error: " + str(e))
        return False

if ACTION == "off":
    result = asyncio.run(samsung_power_off())
    print("OK" if result else "FAILED")
elif ACTION == "on":
    send_wol()
    print("OK")
else:
    print("Usage: samsung-power.py <IP> <MAC> on|off")
