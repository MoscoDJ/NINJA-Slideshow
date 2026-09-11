#!/usr/bin/env python3
"""Control de energia de Samsung Tizen via el remote API + Wake-on-LAN.

Recuperado de la Raspberry Pi y adaptado.

El token se guarda indexado por NOMBRE de pantalla, no por IP (ver la nota en
lg-power.py). Las entradas viejas por IP se siguen leyendo.

Uso: samsung-power.py <IP> <MAC> on|off [--name NOMBRE]
"""
import argparse
import asyncio
import json
import os
import socket
import ssl
import sys

try:
    import websockets
except ImportError:
    sys.exit("Falta el modulo websockets. Instalar con: pip install websockets")

TOKEN_FILE = os.path.expanduser("~/.config/ninja-slideshow/samsung-token.json")


def read_tokens() -> dict:
    try:
        with open(TOKEN_FILE) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def load_token(name: str | None, ip: str) -> str:
    tokens = read_tokens()
    if name and name in tokens:
        return tokens[name]
    return tokens.get(ip, "")


def save_token(name: str | None, ip: str, token: str) -> None:
    tokens = read_tokens()
    tokens[name or ip] = token
    os.makedirs(os.path.dirname(TOKEN_FILE), exist_ok=True)
    with open(TOKEN_FILE, "w") as fh:
        json.dump(tokens, fh, indent=2)
    os.chmod(TOKEN_FILE, 0o600)


def send_wol(mac: str, ip: str) -> None:
    # Broadcast derivado de la IP: la version de la Pi lo tenia fijo en
    # 192.168.10.255 y las pantallas ya viven en varias subredes.
    bcast = ip.rsplit(".", 1)[0] + ".255"
    packet = b"\xff" * 6 + bytes.fromhex(mac.replace(":", "")) * 16
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    for port in (9, 7):
        sock.sendto(packet, (bcast, port))
    sock.close()
    print(f"WOL enviado a {mac} via {bcast}")


async def power_off(ip: str, name: str | None) -> bool:
    token = load_token(name, ip)
    uri = f"wss://{ip}:8002/api/v2/channels/samsung.remote.control"
    if token:
        uri += f"?token={token}"

    # La TV presenta un certificado autofirmado; no hay CA que validar.
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    async with websockets.connect(uri, ssl=ctx, open_timeout=5, close_timeout=3) as ws:
        data = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))

        new_token = data.get("data", {}).get("token")
        if new_token and new_token != token:
            save_token(name, ip, new_token)
            print("Token guardado")

        if data.get("event") != "ms.channel.connect":
            print(f"Respuesta inesperada: {json.dumps(data)[:120]}")
            return False

        await ws.send(
            json.dumps(
                {
                    "method": "ms.remote.control",
                    "params": {
                        "Cmd": "Click",
                        "DataOfCmd": "KEY_POWER",
                        "Option": "false",
                        "TypeOfRemote": "SendRemoteKey",
                    },
                }
            )
        )
        await asyncio.sleep(1)
        print("KEY_POWER enviado")
        return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ip")
    ap.add_argument("mac")
    ap.add_argument("action", choices=["on", "off"])
    ap.add_argument("--name", help="nombre de la pantalla (indice del token)")
    args = ap.parse_args()

    if args.action == "on":
        send_wol(args.mac, args.ip)
        print("OK")
        return 0

    try:
        ok = asyncio.run(power_off(args.ip, args.name))
    except Exception as exc:
        print(f"Error: {exc}")
        return 1

    print("OK" if ok else "FALLO")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
