#!/usr/bin/env python3
"""Control de energia de LG webOS via WebSocket (ssap://).

Recuperado de la Raspberry Pi. El client-key queda guardado tras el primer
emparejamiento; la primera vez hay que aceptar el prompt en la pantalla.
"""
import asyncio, json, sys, os

import websockets

KEY_FILE = os.path.expanduser("~/.config/ninja-slideshow/lg-keys.json")
if len(sys.argv) < 3:
    print("Uso: lg-power.py <IP> on|off")
    sys.exit(2)

TV_IP = sys.argv[1]
ACTION = sys.argv[2]

REGISTER_PAYLOAD = {
    "pairingType": "PROMPT",
    "manifest": {
        "permissions": [
            "CONTROL_POWER",
            "CONTROL_DISPLAY",
            "CONTROL_INPUT_TV",
            "LAUNCH",
            "LAUNCH_WEBAPP",
            "READ_INSTALLED_APPS",
            "CONTROL_AUDIO"
        ]
    }
}

def load_key(ip):
    try:
        with open(KEY_FILE) as f:
            keys = json.load(f)
        return keys.get(ip)
    except:
        return None

def save_key(ip, key):
    keys = {}
    try:
        with open(KEY_FILE) as f:
            keys = json.load(f)
    except:
        pass
    keys[ip] = key
    os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
    with open(KEY_FILE, "w") as f:
        json.dump(keys, f)

async def send_command(uri_cmd):
    uri = "ws://" + TV_IP + ":3000"
    async with websockets.connect(uri, close_timeout=5, open_timeout=5) as ws:
        # Register with saved key or prompt
        payload = dict(REGISTER_PAYLOAD)
        saved_key = load_key(TV_IP)
        if saved_key:
            payload["client-key"] = saved_key

        reg = json.dumps({"type": "register", "payload": payload})
        await ws.send(reg)

        for i in range(5):
            try:
                resp = await asyncio.wait_for(ws.recv(), timeout=15)
                data = json.loads(resp)
                rtype = data.get("type", "")

                if rtype == "registered":
                    client_key = data.get("payload", {}).get("client-key", "")
                    if client_key:
                        save_key(TV_IP, client_key)
                        print("Paired: " + client_key[:16] + "...")

                    cmd = json.dumps({"type": "request", "id": "cmd", "uri": uri_cmd})
                    await ws.send(cmd)
                    r = await asyncio.wait_for(ws.recv(), timeout=5)
                    rd = json.loads(r)
                    print("Result: " + rd.get("type", "unknown"))
                    return rd.get("type") != "error"

            except asyncio.TimeoutError:
                break

    return False

if ACTION == "off":
    result = asyncio.run(send_command("ssap://system/turnOff"))
elif ACTION == "on":
    result = asyncio.run(send_command("ssap://system/turnOn"))
else:
    print("Usage: lg-power.py <IP> on|off")
    sys.exit(1)

print("OK" if result else "FAILED")
sys.exit(0 if result else 1)
