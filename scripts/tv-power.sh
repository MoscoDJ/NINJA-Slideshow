#!/bin/bash
# NINJA Slideshow — encendido/apagado de pantallas.
#
#   tv-power.sh on    Wake-on-LAN a todas (ver la advertencia de subred abajo)
#   tv-power.sh off   Apagado por WebSocket (LG ssap:// , Samsung remote API)
#   tv-power.sh --only NOMBRE on|off
#
# Reemplaza tv-power.sh y samsung/power-off.sh de la Raspberry Pi. El segundo
# se recupero corrupto de la SD (2048 bytes de NUL), asi que su logica se
# reconstruyo aqui sobre samsung-power.py, que si sobrevivio intacto.
set -uo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib-tv.sh"

ONLY=""
ACTION=""

while [ $# -gt 0 ]; do
  case "$1" in
    on|off) ACTION="$1"; shift ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) die "argumento desconocido: $1" ;;
  esac
done

[ -n "$ACTION" ] || die "falta la accion: on|off"
require_conf

# ¿Esta el host en la misma subred /24 que la pantalla? El Wake-on-LAN viaja
# como broadcast de capa 2 y los routers no reenvian broadcasts dirigidos, asi
# que desde otra subred el paquete magico no llega. Con la Pi esto funcionaba
# porque vivia en la red de las pantallas.
same_subnet() {
  local ip="$1" prefix="${1%.*}"
  ip -4 -o addr show scope global | grep -qF " ${prefix}."
}

power_on() {
  local name="$1" type="$2" ip="$3" mac="$4"

  if [ -z "$mac" ]; then
    log "SKIP: $name — sin MAC en el inventario, no se puede hacer WOL"
    return 1
  fi

  local bcast; bcast="$(broadcast_for "$ip")"
  send_wol "$mac" "$bcast"

  if same_subnet "$ip"; then
    log "OK: $name — WOL enviado a $mac via $bcast"
  else
    log "WARN: $name — WOL enviado a $bcast, pero este host no esta en ${ip%.*}.0/24;"
    log "      los broadcasts dirigidos no se enrutan. Usar el timer interno de la"
    log "      pantalla, o un equipo siempre encendido dentro de esa VLAN."
  fi
}

power_off() {
  local name="$1" type="$2" ip="$3" mac="$4"

  case "$type" in
    lg)
      if ! tcp_open "$ip" 3000; then
        log "SKIP: $name ($ip) — puerto 3000 cerrado, se usa el timer de la pantalla"
        return 1
      fi
      if "$PYTHON" "$SCRIPT_DIR/lg-power.py" "$ip" off --name "$name" >>"$LOG_FILE" 2>&1; then
        log "OK: $name apagada"
      else
        log "WARN: $name — apagado por WebSocket fallo"
        return 1
      fi
      ;;
    samsung)
      if ! tcp_open "$ip" 8002; then
        log "SKIP: $name ($ip) — puerto 8002 cerrado"
        return 1
      fi
      if "$PYTHON" "$SCRIPT_DIR/samsung-power.py" "$ip" "$mac" off --name "$name" >>"$LOG_FILE" 2>&1; then
        log "OK: $name apagada"
      else
        log "WARN: $name — apagado por WebSocket fallo"
        return 1
      fi
      ;;
    *) log "ERROR: $name — tipo desconocido '$type'"; return 1 ;;
  esac
}

log "====== Energia: $ACTION ======"

load_tvs
for entry in "${TV_ENTRIES[@]}"; do
  IFS='|' read -r name type ip mac pass <<< "$entry"
  [ -n "${ONLY:-}" ] && [ "$name" != "$ONLY" ] && continue
  case "$ACTION" in
    on)  power_on  "$name" "$type" "$ip" "$mac" || true ;;
    off) power_off "$name" "$type" "$ip" "$mac" || true ;;
  esac
done

log "====== Fin ======"
