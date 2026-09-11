#!/bin/bash
# NINJA Slideshow — encuentra pantallas en la red buscando sus puertos de
# desarrollo. Util tras re-direccionar las pantallas a otro segmento.
#
#   tv-discover.sh             barre la /24 local de este host
#   tv-discover.sh 192.168.20  barre esa /24
#
# Busca por PUERTO TCP, no por ping: el gateway bloquea ICMP echo entre
# subredes, asi que una pantalla alcanzable no necesariamente responde al ping.
set -uo pipefail

source "$(cd "$(dirname "$0")" && pwd)/lib-tv.sh"

PREFIX="${1:-}"
if [ -z "$PREFIX" ]; then
  local_ip="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | head -1)"
  [ -n "$local_ip" ] || die "no se pudo determinar la IP local"
  PREFIX="${local_ip%.*}"
fi

echo "Barriendo ${PREFIX}.0/24 en busca de pantallas..."
echo "  9922  = LG webOS con Developer Mode activo"
echo "  26101 = Samsung Tizen con Developer Mode activo"
echo "  5555  = Android TV / Google TV con depuracion ADB activa"
echo

found=0
for port in 9922 26101 5555; do
  for i in $(seq 1 254); do
    ip="${PREFIX}.${i}"
    ( tcp_open "$ip" "$port" 1 && echo "  ENCONTRADA  $ip:$port" ) &
  done
  wait 2>/dev/null
done

echo
echo "Si no aparece nada: la pantalla esta apagada, el Developer Mode esta"
echo "inactivo, o la ACL no permite llegar. Para LG, revisar la app Developer"
echo "Mode: Dev Mode Status ON y Key Server ON."
echo
echo "Al encontrarlas, actualizar scripts/tvs.conf y correr:"
echo "  scripts/setup-deploy-host.sh"
