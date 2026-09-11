#!/usr/bin/env python3
"""Control de energia de LG webOS via WebSocket (ssap://).

Recuperado de la Raspberry Pi y adaptado.

El client-key se guarda indexado por NOMBRE de pantalla, no por IP: la version
de la Pi usaba la IP como clave, asi que re-direccionar una pantalla perdia el
emparejamiento y obligaba a aceptar el prompt fisicamente otra vez. Las
entradas viejas indexadas por IP se siguen leyendo y se migran al nombre.

Uso: lg-power.py <IP> on|off [--name NOMBRE]
"""
import argparse
import asyncio
import json
import os
import sys

try:
    import websockets
except ImportError:
    sys.exit("Falta el modulo websockets. Instalar con: pip install websockets")

KEY_FILE = os.path.expanduser("~/.config/ninja-slideshow/lg-keys.json")

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
            "CONTROL_AUDIO",
        ]
    },
}

COMMANDS = {"off": "ssap://system/turnOff", "on": "ssap://system/turnOn"}


def read_keys() -> dict:
    try:
        with open(KEY_FILE) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def load_key(name: str | None, ip: str) -> str | None:
    keys = read_keys()
    if name and name in keys:
        return keys[name]
    return keys.get(ip)  # entrada heredada, indexada por IP


def save_key(name: str | None, ip: str, key: str) -> None:
    keys = read_keys()
    keys[name or ip] = key
    os.makedirs(os.path.dirname(KEY_FILE), exist_ok=True)
    with open(KEY_FILE, "w") as fh:
        json.dump(keys, fh, indent=2)
    os.chmod(KEY_FILE, 0o600)


async def send_command(ip: str, uri_cmd: str, name: str | None) -> bool:
    async with websockets.connect(
        f"ws://{ip}:3000", open_timeout=5, close_timeout=5
    ) as ws:
        payload = dict(REGISTER_PAYLOAD)
        saved = load_key(name, ip)
        if saved:
            payload["client-key"] = saved

        await ws.send(json.dumps({"type": "register", "payload": payload}))

        for _ in range(5):
            try:
                data = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            except asyncio.TimeoutError:
                break

            if data.get("type") != "registered":
                continue

            client_key = data.get("payload", {}).get("client-key", "")
            if client_key and client_key != saved:
                save_key(name, ip, client_key)
                print(f"Emparejado: {client_key[:16]}...")

            await ws.send(json.dumps({"type": "request", "id": "cmd", "uri": uri_cmd}))
            result = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
            print(f"Resultado: {result.get('type', 'desconocido')}")
            return result.get("type") != "error"

    return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ip")
    ap.add_argument("action", choices=sorted(COMMANDS))
    ap.add_argument("--name", help="nombre de la pantalla (indice del client-key)")
    args = ap.parse_args()

    try:
        ok = asyncio.run(send_command(args.ip, COMMANDS[args.action], args.name))
    except Exception as exc:
        print(f"Error: {exc}")
        return 1

    print("OK" if ok else "FALLO")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
