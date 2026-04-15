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
| Cliente Pi | Flutter Linux desktop |
| Cliente Android TV | Flutter APK |
| Cliente LG | webOS web app (vanilla JS) |
| Cliente Samsung | Tizen web app (vanilla JS) |

---

## Estructura del proyecto

```
├── server/                  # Backend Express
│   ├── index.ts             # Entry point, Express setup
│   ├── routes.ts            # API, S3, Socket.IO, CORS, auth (signed cookies)
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
npm install
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
| `ADMIN_PASSWORD` | Si | Password para acceder a `/admin` |
| `ADMIN2_PASSWORD` | No | Password alternativo para un segundo admin |
| `SESSION_SECRET` | Si | Secreto para firmar el token de autenticacion (HMAC-SHA256) |
| `PORT` | No | Puerto del servidor (default: `5000`) |
| `NODE_ENV` | No | `production` en deploy |

---

## Deploy en Digital Ocean App Platform

### 1. Spaces bucket

1. Crear un Space en DO (region `sfo3`)
2. Generar credenciales en API > Spaces Keys

> CORS del bucket se configura automaticamente al iniciar el servidor
> via `PutBucketCorsCommand`. No es necesario configurarlo manualmente
> en el panel de DO.

### 2. App Platform

1. Apps > Create App > conectar repo de GitHub
2. Environment: **Node.js**
3. Build command: `npm run build`
4. Run command: `npm start`
5. Port: `3000`
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

## Automatizacion (Raspberry Pi)

La Pi actua como hub de control para todas las pantallas.
Los scripts viven en `/home/<user>/ninja-tv-deploy/` en la Pi.

### Cron (Lunes a Viernes)

| Hora | Accion |
|---|---|
| 9:00 AM | TVs se encienden (timer interno LG / IR blaster) |
| 9:10 AM | Deploy apps en LG y Samsung |
| 8:00 PM | Renovar sesion de Developer Mode (reinstalar) |
| 10:50 PM | Ultima renovacion del dia |
| 11:00 PM | Samsung se apaga via WebSocket API; LGs via timer interno |

### Scripts en la Pi

| Script | Funcion |
|---|---|
| `deploy.sh` | Reinstala app en todas las LG (ares-cli) |
| `deploy-samsung.sh` | Reinstala app en Samsung (sdb via qemu x86) |
| `samsung/power-off.sh` | Apaga Samsung via WebSocket API |
| `tv-power.sh` | Enciende/apaga LGs (WOL + WebSocket) |
| `lg-power.py` | Control de energia LG via WebSocket |

### Setup

- LG: `ares-cli` instalado nativamente (Node 20)
- Samsung: `sdb` x86_64 ejecutado via `qemu-user-static` con `LD_LIBRARY_PATH`
- Clave SSH de LG y token de Samsung se guardan automaticamente

---

## API Reference

| Metodo | Ruta | Auth | Descripcion |
|---|---|---|---|
| `GET` | `/api/files` | No | Lista archivos ordenados |
| `POST` | `/api/upload/presign` | Si | Presigned URL para upload simple |
| `POST` | `/api/upload/confirm` | Si | Confirma upload, notifica clientes |
| `POST` | `/api/upload/init-multipart` | Si | Inicia multipart upload |
| `POST` | `/api/upload/presign-part` | Si | Presigned URL para una parte |
| `POST` | `/api/upload/complete` | Si | Completa multipart upload |
| `POST` | `/api/upload/abort` | Si | Aborta multipart upload |
| `DELETE` | `/api/files/:filename` | Si | Elimina un archivo |
| `POST` | `/api/order` | Si | Actualiza el orden |
| `POST` | `/api/login` | No | Login con password |
| `POST` | `/api/logout` | No | Cerrar sesion |
| `GET` | `/api/auth/status` | No | Verifica si hay sesion activa |

---

## Licencia

MIT
