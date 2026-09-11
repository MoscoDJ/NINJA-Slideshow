#!/bin/bash
# NINJA Slideshow — despliegue a todas las pantallas desde el host de deploy.
#
#   tv-deploy.sh                 solo las que llevan >= 12 h sin desplegarse
#   tv-deploy.sh --force         todas
#   tv-deploy.sh --only NOMBRE   una sola
#   tv-deploy.sh --tag TAG       usa los artefactos de ese release
#
# Reemplaza deploy.sh y deploy-samsung.sh, que vivian en la Raspberry Pi.
set -uo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib-tv.sh"

MAX_HOURS=12
FORCE=0
ONLY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FORCE=1; shift ;;
    --only)  ONLY="${2:-}"; shift 2 ;;
    --tag)   TAG="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) die "argumento desconocido: $1" ;;
  esac
done

require_conf

# Prioridad: Releases/ local (build recien hecho) y si no, los assets del
# release de GitHub, que es donde viven los binarios.
fetch_artifacts "${TAG:-}" || true

pick() {
  ls -t "$PROJECT_DIR"/Releases/$1 2>/dev/null | head -1 \
    || true
}
IPK="$(pick '*.ipk')"
WGT="$(pick '*.wgt')"
[ -n "$IPK" ] || IPK="$(ls -t "$ARTIFACT_DIR"/*.ipk 2>/dev/null | head -1 || true)"
[ -n "$WGT" ] || WGT="$(ls -t "$ARTIFACT_DIR"/*.wgt 2>/dev/null | head -1 || true)"

LG_APP_ID="com.ninja.slideshow"
TIZEN_PKG="ninjSlides"
TIZEN_APP="ninjSlides.NINJASlideshow"

deploy_lg() {
  local name="$1" ip="$2" pass="$3" opts="${4:-}"

  [ -n "$IPK" ] || { log "ERROR: $name — no hay .ipk en Releases/"; return 1; }

  if ! tcp_open "$ip" 9922; then
    log "SKIP: $name ($ip) — puerto 9922 cerrado (pantalla apagada o Dev Mode inactivo)"
    return 1
  fi

  log "--- $name ($ip) ---"
  lg_setup_device "$name" "$ip" "$pass"

  # ares-install sale con codigo 0 incluso cuando falla, y la version de la Pi
  # ademas enmascaraba el estado con `| tee` (el exit code de un pipeline es el
  # del ultimo comando). Por eso el cron reportaba "OK" durante meses sin
  # instalar nada. Aqui se verifica la salida real.
  local out
  out="$(ares-install --device "$name" "$IPK" 2>&1)"
  printf '%s\n' "$out" >> "$LOG_FILE"

  if ! grep -qx 'Success' <<< "$out"; then
    log "ERROR: $name — instalacion fallida: $(grep -m1 'ERR!' <<< "$out" || echo 'sin marcador Success')"
    return 1
  fi

  # nolaunch: instalar sin traer la app a primer plano. Pensado para
  # pantallas compartidas (una sala de juntas) donde forzar el slideshow
  # podria interrumpir una presentacion en curso.
  if tv_has_opt "$opts" nolaunch; then
    mark_success "$name"
    log "OK: $name desplegado (sin lanzar, por 'nolaunch')"
    return 0
  fi

  ares-launch --device "$name" "$LG_APP_ID" >/dev/null 2>&1
  mark_success "$name"
  log "OK: $name desplegado y lanzado"
}

deploy_samsung() {
  local name="$1" ip="$2" opts="${3:-}"

  [ -n "$WGT" ] || { log "ERROR: $name — no hay .wgt firmado en Releases/"; return 1; }
  [ -x "$SDB" ] || { log "ERROR: $name — sdb no encontrado en $SDB"; return 1; }

  if ! tcp_open "$ip" 26101; then
    log "SKIP: $name ($ip) — puerto 26101 cerrado (Developer Mode inactivo)"
    return 1
  fi

  log "--- $name ($ip) ---"
  "$SDB" connect "$ip:26101" >/dev/null 2>&1
  sleep 2

  local remote="/home/owner/share/tmp/sdk_tools/tmp/ninja.wgt"
  "$SDB" -s "$ip:26101" push "$WGT" "$remote" >>"$LOG_FILE" 2>&1

  local out
  out="$("$SDB" -s "$ip:26101" shell "0 vd_appinstall $TIZEN_PKG $remote" 2>&1)"
  printf '%s\n' "$out" >> "$LOG_FILE"

  if ! grep -qi 'install completed' <<< "$out"; then
    log "ERROR: $name — $(head -c 200 <<< "$out")"
    return 1
  fi

  if tv_has_opt "$opts" nolaunch; then
    mark_success "$name"
    log "OK: $name desplegado (sin lanzar, por 'nolaunch')"
    return 0
  fi

  "$SDB" -s "$ip:26101" shell "0 execute $TIZEN_APP" >/dev/null 2>&1
  mark_success "$name"
  log "OK: $name desplegado y lanzado"
}

log "====== Despliegue (ipk=$(basename "${IPK:-ninguno}") wgt=$(basename "${WGT:-ninguno}")) ======"

ok=0; fail=0; skip=0
load_tvs
for entry in "${TV_ENTRIES[@]}"; do
  IFS='|' read -r name type ip mac pass opts <<< "$entry"
  [ -n "${ONLY:-}" ] && [ "$name" != "$ONLY" ] && continue

  if [ "$FORCE" -eq 0 ] && ! needs_deploy "$name" "$MAX_HOURS"; then
    log "SKIP: $name — desplegado hace poco"
    skip=$((skip+1)); continue
  fi

  case "$type" in
    lg)      deploy_lg "$name" "$ip" "$pass" "${opts:-}"  && ok=$((ok+1)) || fail=$((fail+1)) ;;
    samsung) deploy_samsung "$name" "$ip" "${opts:-}"        && ok=$((ok+1)) || fail=$((fail+1)) ;;
    *)       log "ERROR: $name — tipo desconocido '$type'"; fail=$((fail+1)) ;;
  esac
done

log "====== Fin: $ok ok, $fail con error, $skip omitidas ======"
[ "$fail" -eq 0 ]
