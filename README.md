# NINJA Slideshow

Sistema de slideshow digital con gestion de contenidos en tiempo real.
Sube imagenes y videos a Digital Ocean Spaces, ordenalos con drag & drop
desde el panel de admin, y reproducelos en bucle infinito en cualquier
pantalla: browser, Raspberry Pi, Android TV, LG o Samsung.

---

## Arquitectura

```
Browser / Flutter / TV App
        │
        ├── GET  /api/files          (lista ordenada de archivos)
        ├── WS   filesUpdated        (Socket.IO, tiempo real)
        └── PUT  presigned URL       (upload directo a DO Spaces)
        │
   ┌────▼─────┐      ┌──────────────┐
   │  Express  │◄────►│  DO Spaces   │
   │  Node.js  │      │  (S3 bucket) │
   └──────────┘      └──────────────┘
```

| Componente | Tecnologia |
|---|---|
| Backend | Express + Socket.IO (TypeScript) |
| Frontend web | React + Vite + Tailwind/shadcn |
| Storage | Digital Ocean Spaces (S3-compatible) |
| Uploads | Presigned URLs + multipart (AWS SDK v3) |
| Auth | Password via ENV + signed cookie (stateless, multi-instance) |
| Hardening | helmet + CSP, rate limiting, CORS por ruta |
| Cliente Pi | Flutter Linux desktop |
| Cliente Android TV | Flutter APK |
| Cliente LG | webOS web app (vanilla JS) |
| Cliente Samsung | Tizen web app (vanilla JS) |

---

## Estructura del proyecto

```
├── server/                  # Backend Express
│   ├── index.ts             # Entry point, helmet/CSP, compression, errores
│   ├── env.ts               # Config validada (falla al arrancar si falta algo)
│   ├── auth.ts              # Cookies firmadas, rate limiting, comparacion segura
│   ├── routes.ts            # API, S3, Socket.IO, CORS
│   └── vite.ts              # Dev/prod asset serving
├── client/                  # Frontend React
│   ├── public/
│   │   └── logo.png         # Logo NINJA (reemplazar con el real)
│   └── src/
│       ├── pages/
│       │   ├── Slideshow.tsx # Visor fullscreen con memory management
│       │   ├── Admin.tsx     # Panel admin (auth + upload + drag & drop)
│       │   └── Login.tsx     # Pantalla de login
│       └── lib/
│           ├── socket.ts     # Socket.IO client
│           └── queryClient.ts
├── flutter_client/          # App Flutter (Pi + Android TV)
├── webos_app/               # App nativa LG
├── tizen_app/               # App nativa Samsung
├── .env.example             # Variables de entorno
└── package.json
```

---

## URLs

| Ruta | Descripcion |
|---|---|
| `/` | Slideshow publico, fullscreen |
| `/admin` | Panel de administracion (requiere password) |

---

## Instalacion local

```bash
git clone https://github.com/MoscoDJ/NINJA-Slideshow.git
cd NINJA-Slideshow
npm install          # requiere Node >= 22.12
cp .env.example .env
# Editar .env con tus credenciales
npm run dev
```

Abre http://localhost:5000 para el slideshow y http://localhost:5000/admin para admin.

---

## Variables de entorno

| Variable | Requerida | Descripcion |
|---|---|---|
| `SPACES_KEY` | Si | Access key de DO Spaces |
| `SPACES_SECRET_KEY` | Si | Secret key de DO Spaces |
| `BUCKET_NAME` | No | Nombre del bucket (default: `ninjacdn`) |
| `SPACES_REGION` | No | Region del Space (default: `sfo3`) |
| `SPACES_ENDPOINT` | No | Host del endpoint S3 (default: `<region>.digitaloceanspaces.com`) |
| `SPACES_CDN_ENDPOINT` | No | Host del CDN (default: `<region>.cdn.digitaloceanspaces.com`) |
| `ADMIN_PASSWORD` | Si | Password para `/admin`. Minimo 12 caracteres en produccion |
| `ADMIN2_PASSWORD` | No | Password alternativo para un segundo admin |
| `SESSION_SECRET` | Si en prod | Secreto HMAC-SHA256 del token. Minimo 32 caracteres |
| `PORT` | No | Puerto del servidor (default: `5000`) |
| `NODE_ENV` | No | `production` en deploy |
| `TRUST_PROXY` | No | Proxies inversos delante de la app (default: `1`) |
| `CONFIGURE_BUCKET_CORS` | No | `true` aplica la politica CORS del bucket al arrancar (default: `false`) |

El servidor **valida estas variables al arrancar y falla de inmediato** si falta
algo o si un secreto es demasiado corto: es preferible un deploy que no levanta
a uno que levanta con autenticacion debil.

En desarrollo (`NODE_ENV` != `production`) `SESSION_SECRET` es opcional: se
genera uno aleatorio en cada arranque, lo que invalida las sesiones al
reiniciar pero nunca es adivinable.

---

## Deploy en Digital Ocean App Platform

### 1. Spaces bucket

1. Crear un Space en DO (region `sfo3`)
2. Generar credenciales en API > Spaces Keys

> El CORS del bucket se puede aplicar desde la app arrancando **una vez** con
> `CONFIGURE_BUCKET_CORS=true`. No lo dejes activado: seria una escritura de
> configuracion del bucket en cada arranque y en cada instancia.

### 2. App Platform

1. Apps > Create App > conectar repo de GitHub
2. Environment: **Node.js**
3. Build command: `npm run build`
4. Run command: `npm start`
5. Port: `5000` (o el valor de `PORT`)
6. Agregar todas las variables de entorno de la tabla anterior
7. Deploy

### 3. Dominio custom

Configurar tu dominio como custom domain en la App Platform
y apuntar el DNS (CNAME) al dominio que DO asigne.

---

## Autenticacion

El admin usa autenticacion stateless basada en cookies firmadas (HMAC-SHA256).
No depende de sesiones server-side, asi que funciona correctamente con
multiples instancias de DO App Platform y sobrevive restarts/deploys.

- Login valida password → genera token firmado con `SESSION_SECRET` → cookie `ninja_auth`
- Cada request protegido verifica la firma del token (cualquier instancia puede hacerlo)
- `ADMIN_PASSWORD` y opcionalmente `ADMIN2_PASSWORD` permiten dos accesos con distintas contraseñas
- `GET /api/files` y Socket.IO son publicos (los necesitan el slideshow, Flutter y las TVs)
- Todo lo demas (`upload`, `delete`, `order`) requiere token valido

---

## Seguridad

| Medida | Detalle |
|---|---|
| Secretos obligatorios | Sin `SESSION_SECRET` en produccion el server no arranca. No hay fallback de desarrollo que permita firmar cookies de admin |
| Comparaciones en tiempo constante | Password y firma del token se comparan por hash de longitud fija, sin filtrar informacion por timing |
| Rate limiting | 10 intentos de login por IP cada 15 min; 300 req/min en las rutas de escritura |
| Cookie | `HttpOnly`, `SameSite=Lax` y `Secure` en produccion |
| CORS por ruta | `*` sin credenciales solo en las rutas publicas de lectura (lo que necesitan las TVs). Las rutas de admin son same-origin: ninguna web externa puede invocarlas con la cookie del admin |
| CSP | `helmet` con Content-Security-Policy estricta en produccion (desactivada en dev para el HMR de Vite) |
| Validacion de nombres | Los `filename`/`key` del cliente se normalizan y se validan contra una allowlist, con extension permitida obligatoria. No se puede escribir ni borrar fuera de `slideshow/` |
| Limite de subida | 2 GB declarados y verificados antes de firmar la URL |
| Errores | El cliente recibe mensajes genericos; el stack trace queda en los logs del servidor |
| `trust proxy` acotado | Numero exacto de proxies, para que no se pueda falsear `X-Forwarded-For` y esquivar el rate limit |

Las apps de TV cargan el cliente de Socket.IO desde el propio servidor
(`/socket.io/socket.io.js`) en lugar de un CDN externo: menos superficie de
supply chain en pantallas que quedan encendidas sin supervision, y la version
siempre casa con la del backend.

Auditoria de dependencias:

```bash
npm audit            # 0 vulnerabilidades
npm run check        # typecheck
```

---

## Uploads

Los archivos se suben directo del browser a DO Spaces usando presigned URLs.
El servidor nunca bufferea el archivo en memoria.

- **Archivos < 100 MB:** presigned PUT simple
- **Archivos >= 100 MB:** multipart upload con partes de 10 MB en paralelo (hasta 4 simultaneas)
- **Tamaño maximo:** 2 GB+
- **Tipos permitidos:** JPEG, PNG, GIF, WebP, MP4, WebM
- Barra de progreso en tiempo real con opcion de cancelar

---

## Cache y tiempo real

- `/api/files` retorna `Cache-Control: no-cache` + `ETag` (304 si no hay cambios)
- Las URLs de medios incluyen `?v={timestamp}` para cache-busting cuando un archivo se re-sube
- Socket.IO emite `filesUpdated` despues de cada upload/delete/reorder
- Los clientes (web, Flutter, TV apps) escuchan ese evento y refrescan la lista
- El slideshow web hace auto-reload cada 5 loops completos para reclamar memoria (3 en TVs)

---

## Branding

El panel de admin y login usan los colores institucionales NINJA:

- **Rojo NINJA:** `#ec1c24`
- **Negro** y **blanco** como colores base

El logo se carga desde `client/public/logo.png`. Para actualizarlo,
reemplazar ese archivo y hacer deploy.

---

## Clientes (plataformas de reproduccion)

### Browser (web)

El slideshow web funciona en cualquier browser moderno accediendo a la ruta `/`.

Incluye manejo agresivo de memoria para funcionar en browsers limitados
(Smart TVs): limpieza explicita de buffers de video y auto-reload periodico.

### Raspberry Pi (Chromium kiosk)

Chromium en modo kiosk sobre X11 minimal (sin escritorio, matchbox-wm).
GPU memory en 256MB para mejor rendimiento de video.

```bash
bash scripts/setup-raspberry-pi.sh https://your-domain.com
sudo reboot
```

### Android TV — Haier, Sharp (Flutter APK)

App Flutter compilada para Android TV. Incluye soporte para leanback
launcher, D-pad navigation, wakelock, y fullscreen inmersivo.
Ver [`flutter_client/README.md`](flutter_client/README.md).

```bash
cd flutter_client
flutter build apk --release
# Instalar: adb connect <TV_IP>:5555 && adb install build/app/outputs/flutter-apk/app-release.apk
```

### LG (webOS)

App web nativa empaquetada como IPK. Vanilla JS con manejo agresivo de
memoria y auto-reload cada 3 loops. Resuelve el problema de congelamiento
del browser integrado de LG.
Ver [`webos_app/README.md`](webos_app/README.md).

```bash
cd webos_app
ares-package .
ares-install --device lgtv com.ninja.slideshow_1.0.0_all.ipk
```

### Samsung (Tizen)

App web nativa empaquetada como WGT. Requiere certificado Samsung
(Tizen Studio + Samsung Developer account). Apagado remoto via
WebSocket API (Samsung Smart TV protocol).
Ver [`tizen_app/README.md`](tizen_app/README.md).

```bash
tizen package -t wgt -s <perfil-samsung> -- tizen_app/
sdb connect <TV_IP>:26101
sdb shell "0 vd_appinstall ninjSlides /path/to/ninja.wgt"
```

### Resumen de plataformas

| Plataforma | Marcas | Directorio | Compilacion | Output |
|---|---|---|---|---|
| Browser | Cualquiera | `client/` | `npm run build` | SPA (servida por Express) |
| Chromium Kiosk | Raspberry Pi | `scripts/` | `setup-raspberry-pi.sh` | Chromium fullscreen |
| Android TV | Haier, Sharp | `flutter_client/` | `flutter build apk` | APK |
| webOS | LG | `webos_app/` | `ares-package` | IPK |
| Tizen | Samsung | `tizen_app/` | `tizen package` | WGT |

---

## Automatizacion (host de despliegue)

La Raspberry Pi que hacia de hub murio en junio de 2026. Su rol lo toma
cualquier equipo con `ares-cli` y Tizen Studio; los scripts viven en
[`scripts/`](scripts/) y ya no dependen de la Pi.

### Puesta en marcha

```bash
cp scripts/tvs.conf.example scripts/tvs.conf   # editar IPs y passphrases
bash scripts/setup-deploy-host.sh              # verifica todo y registra las LG
```

`tvs.conf` esta en `.gitignore`: contiene las passphrases de Developer Mode.

### Scripts

| Script | Funcion |
|---|---|
| `setup-deploy-host.sh` | Prepara el host: ares-cli, sdb, venv, inventario, alcance |
| `tv-discover.sh` | Busca pantallas en una /24 por sus puertos de Developer Mode |
| `tv-deploy.sh` | Despliega en todas las pantallas (LG por ares, Samsung por sdb) |
| `tv-power.sh` | Encendido por WOL / apagado por WebSocket |
| `lg-power.py` | Control de energia LG via `ssap://` |
| `samsung-power.py` | Control de energia Samsung via remote API |
| `lib-tv.sh` | Helpers compartidos |

Los binarios se bajan solos del release mas reciente de GitHub
(`gh release download`) y se cachean en
`~/.local/state/ninja-slideshow/artifacts`. Con `--tag` se fija otro release.

```bash
scripts/tv-deploy.sh                  # solo las que llevan >= 12 h
scripts/tv-deploy.sh --force          # todas
scripts/tv-deploy.sh --only lgtv-it   # una
scripts/tv-power.sh off               # apagar todas
```

### Cron (lunes a viernes)

| Hora | Accion |
|---|---|
| 9:10 | `tv-deploy.sh` |
| 20:00 | `tv-deploy.sh --force` — renueva la sesion de Developer Mode |
| 22:50 | `tv-deploy.sh --force` — ultima renovacion |
| 23:00 | `tv-power.sh off` |

La sesion de Developer Mode de LG expira a las ~50 h; por eso se reinstala.
Cuando expira, webOS **borra** las apps instaladas en modo desarrollador: es
lo que dejo la pantalla de Diseno sin app durante meses.

Se instala con `crontab -e` apuntando a las rutas absolutas del repo. No hace
falta exportar el PATH: `lib-tv.sh` resuelve por su cuenta el bin de node
(cron arranca con un PATH minimo y sin el de nvm, asi que `ares-*` no
existiria y cada corrida fallaria en silencio).

Mientras alguna pantalla no tenga artefacto o no sea alcanzable,
`tv-deploy.sh` termina con codigo distinto de cero. Es intencional: reportar
exito sin haber instalado nada es justo el fallo que tenia la Pi.

### Diferencias respecto al setup de la Pi

- **`sdb` nativo.** La Pi era ARM y ejecutaba un `sdb` x86 bajo
  `qemu-user-static` con `LD_LIBRARY_PATH`. En un host x86_64 se usa
  directamente el de Tizen Studio.
- **Alcance por TCP, no por ping.** El gateway bloquea ICMP echo entre
  subredes, asi que una pantalla encendida y alcanzable por TCP no responde al
  ping. Los scripts de la Pi usaban `ping` y saltaban pantallas disponibles.
- **Deteccion real de exito.** `deploy.sh` de la Pi hacia
  `if ares-install ... | tee -a "$LOG"; then`, y el exit code de un pipeline es
  el del ultimo comando (`tee`), que siempre triunfa. Ademas `ares-install`
  sale con 0 incluso al fallar. El cron reporto "OK: deployed" durante meses
  sin instalar nada: los `state/*.last` de junio eran falsos positivos. Ahora
  se verifica la linea `Success` en la salida.
- **Sin `pip --break-system-packages`.** `websockets` vive en un venv propio en
  `~/.local/share/ninja-slideshow/venv`.
- **Inventario fuera del codigo.** Las IPs y passphrases estan en `tvs.conf`,
  no hardcodeadas en cada script.

### Segmentacion de red

WOL viaja como broadcast de capa 2 y los routers no reenvian broadcasts
dirigidos, asi que **solo funciona si el host de deploy esta en la misma
subred /24 que la pantalla**.

Por eso las pantallas LG se colocan en el mismo segmento que el host de
deploy: no hacen falta ACLs y el WOL vuelve a funcionar. `tv-power.sh` detecta
el caso y avisa cuando el host no comparte subred con la pantalla, en lugar de
fallar en silencio.

| Pantalla | Segmento | Acceso | Encendido |
|---|---|---|---|
| LG (IT, Diseno, Produccion) | El del host de deploy | Directo | WOL |
| Samsung Sala de Juntas | Separado (ahi presentan los jefes) | ACL | Timer interno |

Tras mover una pantalla de segmento, `scripts/tv-discover.sh` la localiza
barriendo la /24 por sus puertos de Developer Mode (9922 en LG, 26101 en
Samsung). Busca por puerto TCP y no por ping, porque el gateway bloquea ICMP
echo entre subredes.

### Samsung: el `developerIP` de la pantalla

El Developer Mode de Tizen guarda la **IP del host** autorizado a conectarse.
La pantalla acepta el TCP en el 26101 desde cualquier origen pero **corta la
conexion** (`Connection reset by peer`) en cuanto habla el protocolo de `sdb`
si el peer no es esa IP. El sintoma es un `failed to connect` con el puerto
abierto, que es facil de confundir con un problema de ACL.

Para comprobar cual tiene configurada, sin tocar la pantalla:

```bash
curl -s http://<ip>:8001/api/v2/ | python3 -m json.tool | grep -E "developerIP|developerMode|PowerState"
```

Al cambiar de host de deploy hay que actualizarla en la pantalla: **Apps**,
teclear **1 2 3 4 5** en el control, poner la IP del host nuevo y reiniciar.

Ese mismo endpoint sirve para saber si la pantalla esta encendida
(`PowerState`) y si el Developer Mode esta activo (`developerMode: 1`), sin
depender de `sdb`.

### Puertos

Verificados contra las herramientas, no de memoria: el key server de webOS
sale de `lib/base/novacom.js` de `@webos-tools/cli`
(`http://<host>:9991/webos_rsa`) y el de Samsung del propio binario `sdb`.

**Host de deploy -> pantalla** (lo que hay que permitir en la ACL)

| Pantalla | Puerto | Proto | Para que | Lo usa |
|---|---|---|---|---|
| LG | 9922 | TCP | SSH de Developer Mode: instalar y lanzar | `ares-install`, `ares-launch` |
| LG | 9991 | TCP | Key server: descarga de la llave SSH | `ares-novacom --getkey` |
| LG | 3000 | TCP | API `ssap://` sobre ws: apagado | `lg-power.py` |
| LG | 3001 | TCP | Igual que 3000 sobre TLS | opcional, no lo usan los scripts |
| Samsung | 26101 | TCP | sdb: push del `.wgt`, `vd_appinstall`, `execute` | `tv-deploy.sh` |
| Samsung | 8002 | TCP | Remote API sobre wss: apagado | `samsung-power.py` |
| Samsung | 8001 | TCP | Remote API sobre http: info del dispositivo | opcional, diagnostico |
| Ambas | 9 y 7 | UDP | Wake-on-LAN | `tv-power.sh`, solo en la misma /24 |

Lo minimo para operar una Samsung por ACL son **dos reglas**: 26101 y 8002.
Para una LG son **tres**: 9922, 9991 y 3000.

Conviene acotar el origen a la IP del host de deploy en lugar de abrir el
segmento completo.

**Pantalla -> internet** (sin esto la app arranca pero no muestra nada)

| Destino | Puerto | Proto | Para que |
|---|---|---|---|
| Dominio del servidor | 443 | TCP | `/api/files`, `/socket.io/socket.io.js` y el WebSocket de Socket.IO |
| `<bucket>.<region>.cdn.digitaloceanspaces.com` | 443 | TCP | Imagenes y videos |
| DNS | 53 | UDP/TCP | Resolucion de ambos dominios |

El WebSocket de Socket.IO sube por el mismo 443 con un `Upgrade`. Si un proxy
o la ACL rompen ese upgrade, las apps de TV degradan solas a consultar cada
30 s: siguen funcionando, pero los cambios de contenido tardan en aparecer en
lugar de ser inmediatos.

ICMP echo no hace falta: los scripts comprueban alcance por TCP. Solo conviene
permitirlo si se quiere que `ping` sirva para diagnosticar a mano.

### Emparejamientos

Recuperados de la SD de la Pi y remapeados a las IPs estaticas nuevas:

| Archivo | Contenido |
|---|---|
| `~/.config/ninja-slideshow/lg-keys.json` | client-key de cada LG (`ssap://`) |
| `~/.config/ninja-slideshow/samsung-token.json` | token del remote API de Samsung |
| `~/.ssh/<nombre>_webos` | llave SSH de Developer Mode por pantalla |

Sin estos archivos, el primer emparejamiento exige aceptar un prompt
fisicamente en cada pantalla.

Estan indexados por **nombre de pantalla**, no por IP. Los scripts de la Pi
usaban la IP como clave, asi que re-direccionar una pantalla perdia el
emparejamiento; con el nombre, cambiar de segmento no cuesta nada. Las
entradas heredadas por IP se siguen leyendo.

---

## API Reference

| Metodo | Ruta | Auth | Descripcion |
|---|---|---|---|
| `GET` | `/api/files` | No | Lista archivos ordenados (CORS publico, `ETag`) |
| `POST` | `/api/upload/presign` | Si | Presigned URL para upload simple |
| `POST` | `/api/upload/confirm` | Si | Confirma upload, notifica clientes |
| `POST` | `/api/upload/init-multipart` | Si | Inicia multipart upload |
| `POST` | `/api/upload/presign-part` | Si | Presigned URL para una parte |
| `POST` | `/api/upload/complete` | Si | Completa multipart upload |
| `POST` | `/api/upload/abort` | Si | Aborta multipart upload |
| `DELETE` | `/api/files/:filename` | Si | Elimina un archivo |
| `POST` | `/api/order` | Si | Actualiza el orden |
| `POST` | `/api/login` | No | Login con password (10 intentos / 15 min / IP) |
| `POST` | `/api/logout` | No | Cerrar sesion |
| `GET` | `/api/auth/status` | No | Verifica si hay sesion activa |

---

## Licencia

MIT
