#!/bin/bash
# NINJA Slideshow — prepara esta maquina como host de despliegue.
#
# Sustituye a la Raspberry Pi que hacia de hub. Idempotente: se puede
# volver a correr sin romper nada.
set -euo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib-tv.sh"

echo "=== 1. ares-cli (LG webOS) ==="
if command -v ares-install >/dev/null 2>&1; then
  echo "  ya instalado: $(command -v ares-install)"
else
  echo "  instalando @webos-tools/cli..."
  npm install -g @webos-tools/cli
fi

echo "=== 2. sdb (Samsung Tizen) ==="
if [ -x "$SDB" ]; then
  echo "  nativo: $SDB ($("$SDB" version 2>&1 | head -1))"
else
  echo "  FALTA. Instalar Tizen Studio, o ajustar SDB en lib-tv.sh"
fi

echo "=== 3. dependencias de Python ==="
if "$PYTHON" -c 'import websockets' 2>/dev/null; then
  echo "  websockets OK ($PYTHON)"
else
  echo "  falta websockets. Crear el venv:"
  echo "    python3 -m venv ~/.local/share/ninja-slideshow/venv"
  echo "    ~/.local/share/ninja-slideshow/venv/bin/pip install websockets"
fi

echo "=== 4. inventario ==="
if [ -f "$CONF_FILE" ]; then
  echo "  $CONF_FILE ($(tv_list | wc -l) pantallas)"
else
  echo "  creando desde la plantilla; revisar IPs y passphrases"
  cp "$SCRIPT_DIR/tvs.conf.example" "$CONF_FILE"
  chmod 600 "$CONF_FILE"
fi

echo "=== 5. emparejamientos ==="
for f in lg-keys.json samsung-token.json; do
  p="$HOME/.config/ninja-slideshow/$f"
  [ -f "$p" ] && echo "  $f OK ($(python3 -c "import json;print(len(json.load(open('$p'))))" ) entradas)" \
              || echo "  $f ausente — se creara al primer emparejamiento (requiere aceptar el prompt en la pantalla)"
done

echo "=== 6. registro de pantallas LG en ares ==="
load_tvs
for entry in "${TV_ENTRIES[@]}"; do
  IFS='|' read -r name type ip mac pass <<< "$entry"
  [ "$type" = "lg" ] || continue
  ares-setup-device --add "$name" \
    --info "{'host':'$ip','port':'9922','username':'prisoner'}" </dev/null >/dev/null 2>&1 || true
  echo "  $name -> $ip"
done

echo "=== 7. alcance de red ==="
for entry in "${TV_ENTRIES[@]}"; do
  IFS='|' read -r name type ip mac pass <<< "$entry"
  port=9922; [ "$type" = "samsung" ] && port=26101
  if tcp_open "$ip" "$port" 3; then
    echo "  $name ($ip:$port) ALCANZABLE"
  else
    echo "  $name ($ip:$port) sin respuesta — pantalla apagada, Dev Mode inactivo o ACL cerrada"
  fi
done

cat <<'NOTE'

=== Cron sugerido (crontab -e) ===
  10 9  * * 1-5  /ruta/al/repo/scripts/tv-deploy.sh >/dev/null 2>&1
  0  20 * * 1-5  /ruta/al/repo/scripts/tv-deploy.sh --force >/dev/null 2>&1
  50 22 * * 1-5  /ruta/al/repo/scripts/tv-deploy.sh --force >/dev/null 2>&1
  0  23 * * 1-5  /ruta/al/repo/scripts/tv-power.sh off >/dev/null 2>&1

El re-despliegue de las 20:00 y 22:50 renueva la sesion de Developer Mode,
que expira a las ~50 h.

Wake-on-LAN: solo funciona si el host esta en la misma subred /24 que la
pantalla. Esta maquina no lo esta, asi que el encendido depende del timer
interno de cada pantalla.
NOTE
