#!/bin/bash
# Uso: scripts/tv-memcheck.sh <apk> <etiqueta>
# Despliega el APK en el Chromecast por tv-deploy.sh y mide PSS/pid cada 5 s
# desde t=0 durante 300 s; al final lista MAX_PSS y muertes (exit-info).
# Sirve para comparar builds con el mismo instrumento (ver README, fuga).
export PATH="$HOME/.nvm/versions/node/v24.20.0/bin:$HOME/Android/Sdk/platform-tools:$PATH"
APK="$1"; TAG="$2"; D=192.168.40.177:5555; SD=$(dirname "$0"); REPO="/home/oscar/Cursor/Ninja Slideshow/NINJA-Slideshow"
cp "$APK" "$REPO/Releases/ninja-slideshow-android-tv-$TAG.apk"
( cd "$REPO" && bash scripts/tv-deploy.sh --force --only chromecast-pasillo 2>&1 | grep -E "kiosk|OK:|ERROR|WARN" )
adb connect $D >/dev/null 2>&1; sleep 2
INST=$(date '+%Y-%m-%d %H:%M:%S'); P0=$(adb -s $D shell pidof mx.com.ninja.slideshow 2>/dev/null | tr -d '\r')
echo "instalado $INST pid=$P0 version=$(adb -s $D shell dumpsys package mx.com.ninja.slideshow | tr -d '\r' | grep -oE 'versionName=[^ ]+' | head -1)"
T0=$SECONDS; MAX=0
while [ $((SECONDS-T0)) -le 300 ]; do t=$((SECONDS-T0)); Pn=$(adb -s $D shell pidof mx.com.ninja.slideshow 2>/dev/null | tr -d '\r'); T=$(adb -s $D shell dumpsys meminfo $Pn 2>/dev/null | tr -d '\r' | awk '/TOTAL PSS:/{print int($3/1024); exit}'); [ "${T:-0}" -gt "$MAX" ] && MAX=$T; echo "t+${t}s pid=$Pn PSS=${T}MB $( [ "$Pn" = "$P0" ] && echo ok || echo '*** MURIO ***')"; sleep 5; done
echo "MAX_PSS=${MAX}MB"; adb -s $D shell dumpsys activity exit-info mx.com.ninja.slideshow | tr -d '\r' | grep -E "timestamp=|reason=" | paste - - | sed -E 's/^[^t]*timestamp=([0-9-]+ [0-9:]+)\.[0-9]+.* reason=[0-9]+ \(([A-Z_ ]+)\).*/\1 \2/' | awk -v i="$INST" '$1" "$2 > i {print "MUERTE " $0}'; echo "FIN-AFTER"
