#!/bin/bash
# Helpers compartidos por tv-deploy.sh y tv-power.sh.
# shellcheck shell=bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

CONF_FILE="${TVS_CONF:-$SCRIPT_DIR/tvs.conf}"
GH_REPO="${GH_REPO:-MoscoDJ/NINJA-Slideshow}"
STATE_DIR="${TV_STATE_DIR:-$HOME/.local/state/ninja-slideshow}"
LOG_FILE="${TV_LOG:-$STATE_DIR/tv.log}"

# sdb nativo de Tizen Studio. La Pi usaba un binario x86 bajo qemu porque era
# ARM; en un host x86_64 eso ya no hace falta.
SDB="${SDB:-$HOME/tizen-studio/tools/sdb}"

# adb para dispositivos Android TV / Google TV (Chromecast con Google TV,
# Haier, Sharp). El slideshow ahi es el APK de Flutter.
ADB="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"

# Paquete y actividad del APK (mx.com.ninja.slideshow / MainActivity).
ANDROID_PKG="${ANDROID_PKG:-mx.com.ninja.slideshow}"

# Los scripts de energia necesitan `websockets`. Las distros con PEP 668
# (externally-managed) rechazan instalarlo en el Python del sistema, asi que
# vive en un venv propio. La Pi lo resolvia con --break-system-packages, que
# toca el Python del sistema.
VENV_PYTHON="$HOME/.local/share/ninja-slideshow/venv/bin/python"
if [ -x "$VENV_PYTHON" ]; then
  PYTHON="$VENV_PYTHON"
else
  PYTHON="python3"
fi

mkdir -p "$STATE_DIR"

# cron arranca con un PATH minimo (/usr/bin:/bin), sin el de nvm, asi que
# ares-* no existiria y cada corrida fallaria en silencio. Se resuelve el bin
# de node dinamicamente para no fijar la version en una ruta.
ensure_tools_path() {
  command -v ares-install >/dev/null 2>&1 && return 0

  local candidate
  for candidate in \
    "$(command -v node 2>/dev/null | xargs -r dirname)" \
    "$HOME/.nvm/current/bin" \
    $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1) \
    "/usr/local/bin"
  do
    if [ -n "$candidate" ] && [ -x "$candidate/ares-install" ]; then
      PATH="$candidate:$PATH"
      export PATH
      return 0
    fi
  done

  log "WARN: no se encontro ares-install en el PATH; las pantallas LG fallaran"
  return 1
}

ensure_tools_path || true

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" | tee -a "$LOG_FILE"
}

die() { log "FATAL: $1"; exit 1; }

require_conf() {
  [ -f "$CONF_FILE" ] || die "falta $CONF_FILE (copiar de tvs.conf.example)"
}

# Itera el inventario, saltando comentarios y lineas vacias.
tv_list() {
  grep -vE '^\s*(#|$)' "$CONF_FILE"
}

# Devuelve 0 si la pantalla declara la opcion indicada en su 6o campo.
tv_has_opt() {
  local opts="$1" want="$2"
  [ -n "$opts" ] || return 1
  printf '%s' "$opts" | tr ',' '\n' | grep -qx "$want"
}

# Carga el inventario en el arreglo TV_ENTRIES.
#
# Importante: NO recorrer el inventario con `while read ... < <(tv_list)`.
# Herramientas como ares-setup-device, sdb o ssh leen stdin y se comen las
# lineas que faltan, con lo que el bucle procesa solo la primera pantalla.
# Con un arreglo el bucle no depende de stdin.
TV_ENTRIES=()
load_tvs() {
  require_conf
  TV_ENTRIES=()
  local line
  while IFS= read -r line; do
    TV_ENTRIES+=("$line")
  done < <(tv_list)
}

# Comprobacion de alcance por TCP, no por ping.
#
# El ping NO sirve en esta red: el gateway bloquea ICMP echo entre subredes,
# asi que una pantalla encendida y perfectamente alcanzable por TCP no
# responde al ping. Los scripts de la Pi usaban ping y por eso saltaban
# pantallas que si estaban disponibles.
tcp_open() {
  local ip="$1" port="$2" timeout="${3:-4}"
  timeout "$timeout" bash -c "exec 3<>/dev/tcp/$ip/$port" 2>/dev/null
}

# Direccion de broadcast del /24 al que pertenece la IP.
broadcast_for() {
  echo "${1%.*}.255"
}

send_wol() {
  local mac="$1" bcast="$2"
  "$PYTHON" - "$mac" "$bcast" <<'PY'
import socket, sys
mac, bcast = sys.argv[1], sys.argv[2]
packet = b"\xff" * 6 + bytes.fromhex(mac.replace(":", "")) * 16
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
for port in (9, 7):
    s.sendto(packet, (bcast, port))
s.close()
PY
}

state_file() { echo "$STATE_DIR/$1.last"; }

needs_deploy() {
  local name="$1" max_hours="${2:-12}"
  local f; f="$(state_file "$name")"
  [ -f "$f" ] || return 0
  local last now
  last="$(cat "$f")"
  now="$(date +%s)"
  [ "$(( (now - last) / 3600 ))" -ge "$max_hours" ]
}

mark_success() { date +%s > "$(state_file "$1")"; }

# Registra la pantalla LG en ares y recupera la llave SSH con la passphrase.
lg_setup_device() {
  local name="$1" ip="$2" pass="$3"

  # --add falla si la pantalla ya esta registrada, dejando la IP vieja en la
  # configuracion; --modify la actualiza. Se intenta modificar primero y se
  # agrega solo si no existia. La llave y la passphrase van en el registro
  # para que ares pueda descifrar la llave privada.
  local key="${name}_webos"
  local info="{'host':'$ip','port':'9922','username':'prisoner','privateKey':'$key','passphrase':'$pass'}"

  if ares-setup-device --list 2>/dev/null | awk '{print $1}' | grep -qx "$name"; then
    ares-setup-device --modify "$name" --info "$info" </dev/null >/dev/null 2>&1 || true
  else
    ares-setup-device --add "$name" --info "$info" </dev/null >/dev/null 2>&1 || true
  fi

  # Si ya hay una llave que funciona, no hace falta volver a pedirla: el key
  # server (TCP 9991) solo esta activo mientras "Key Server" este encendido en
  # la app Developer Mode.
  if [ -f "$HOME/.ssh/$key" ] && ares-device -i --device "$name" </dev/null >/dev/null 2>&1; then
    return 0
  fi

  if ! tcp_open "$ip" 9991 3; then
    log "WARN: $name — key server (9991) cerrado y sin llave valida."
    log "      Encender 'Key Server' en la app Developer Mode de la pantalla."
    return 1
  fi

  # ares-novacom pide la passphrase por stdin de forma interactiva.
  node - "$name" "$pass" <<'JS' 2>/dev/null
const { spawn } = require("child_process");
const [name, pass] = process.argv.slice(2);
const p = spawn("ares-novacom", ["--device", name, "--getkey"], { stdio: ["pipe", "pipe", "pipe"] });
p.stdout.on("data", (d) => {
  if (d.toString().toLowerCase().includes("passphrase")) {
    setTimeout(() => p.stdin.write(pass + "\n"), 300);
  }
});
setTimeout(() => process.exit(0), 6000);
JS
}

# Directorio de artefactos. Los binarios ya no se versionan en el repo: viven
# como assets de GitHub Releases, asi que el host de deploy los baja aqui.
ARTIFACT_DIR="${ARTIFACT_DIR:-$STATE_DIR/artifacts}"

# Descarga los artefactos del release indicado (por defecto el mas reciente).
# Si ya estan en cache no vuelve a bajarlos.
fetch_artifacts() {
  local tag="${1:-}"
  mkdir -p "$ARTIFACT_DIR"

  if ! command -v gh >/dev/null 2>&1; then
    log "WARN: falta gh, no se pueden bajar artefactos (usar ARTIFACT_DIR manual)"
    return 1
  fi

  if [ -z "$tag" ]; then
    tag="$(gh release list --repo "$GH_REPO" --limit 1 --json tagName --jq '.[0].tagName' 2>/dev/null)"
  fi
  [ -n "$tag" ] || { log "WARN: no se pudo determinar el release mas reciente"; return 1; }

  if [ -f "$ARTIFACT_DIR/.tag" ] && [ "$(cat "$ARTIFACT_DIR/.tag")" = "$tag" ] \
     && ls "$ARTIFACT_DIR"/*.ipk >/dev/null 2>&1; then
    log "Artefactos de $tag ya en cache"
    return 0
  fi

  log "Bajando artefactos de $tag..."
  rm -f "$ARTIFACT_DIR"/*.ipk "$ARTIFACT_DIR"/*.wgt "$ARTIFACT_DIR"/*.apk
  gh release download "$tag" --repo "$GH_REPO" --dir "$ARTIFACT_DIR" \
     --pattern '*.ipk' --pattern '*.wgt' --pattern '*.apk' --clobber </dev/null >>"$LOG_FILE" 2>&1 || true

  if ls "$ARTIFACT_DIR"/*.ipk >/dev/null 2>&1 || ls "$ARTIFACT_DIR"/*.wgt >/dev/null 2>&1; then
    printf '%s' "$tag" > "$ARTIFACT_DIR/.tag"
    log "Artefactos listos: $(ls "$ARTIFACT_DIR" | grep -vE '^\.' | tr '\n' ' ')"
    return 0
  fi
  log "WARN: no se bajo ningun artefacto de $tag"
  return 1
}
