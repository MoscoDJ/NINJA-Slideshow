# NINJA Slideshow

Sistema de slideshow digital con gestion de contenidos en tiempo real.
Sube imagenes y videos a Digital Ocean Spaces, ordenalos con drag & drop
desde el panel de admin, y reproducelos en bucle infinito en cualquier
pantalla: browser, Raspberry Pi, Android TV, LG o Samsung.

**Produccion:** `https://your-domain.com`

---

## Arquitectura

```
Browser / Flutter / TV App
        │
        ├── GET  /api/files          (lista ordenada de archivos)
        ├── WS   filesUpdated        (Socket.IO, actualizacion en tiempo real)
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
| Auth | Password via ENV + express-session |
| DB | PostgreSQL/Drizzle (scaffold, no activo) |
| Cliente Pi | Flutter Linux desktop |
| Cliente Android TV | Flutter APK |
| Cliente LG | webOS web app (vanilla JS) |
| Cliente Samsung | Tizen web app (vanilla JS) |

---

## Estructura del proyecto

```
├── server/                  # Backend Express
│   ├── index.ts             # App entry, session middleware
│   ├── routes.ts            # API routes, S3 client, Socket.IO
│   └── vite.ts              # Dev/prod asset serving
├── client/                  # Frontend React
│   └── src/
│       ├── pages/
│       │   ├── Slideshow.tsx # Visor fullscreen con memory management
│       │   ├── Admin.tsx     # Panel admin (auth + upload + drag & drop)
│       │   └── Login.tsx     # Login page
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
| `https://your-domain.com/` | Slideshow (publico, fullscreen) |
| `https://your-domain.com/admin` | Panel de administracion (requiere password) |

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
| `SESSION_SECRET` | Si | Secreto para firmar cookies de sesion |
| `PORT` | No | Puerto del servidor (default: `5000`) |
| `NODE_ENV` | No | `production` en deploy |

---

## Deploy en Digital Ocean App Platform

### 1. Spaces bucket

1. Crear un Space en DO (region `sfo3`)
2. Generar credenciales en API > Spaces Keys

> CORS del bucket se configura automaticamente al iniciar el servidor.
> No es necesario configurarlo manualmente en el panel de DO.

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

El admin esta protegido por password. Se configura con `ADMIN_PASSWORD` en DO App Platform.
Opcionalmente, `ADMIN2_PASSWORD` permite un segundo acceso con contraseña distinta.

- `GET /api/files` es publico (lo necesitan el slideshow, Flutter y las TVs)
- Socket.IO (`filesUpdated`) es publico
- Todo lo demas (`upload`, `delete`, `order`) requiere sesion autenticada

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

## Cache

- `/api/files` retorna `Cache-Control: no-cache` + `ETag` (304 si no hay cambios)
- Las URLs de medios incluyen `?v={timestamp}` para cache-busting cuando un archivo se re-sube
- Socket.IO emite `filesUpdated` despues de cada upload/delete/reorder
- Los clientes (web, Flutter, TV apps) escuchan ese evento y refrescan la lista
- El slideshow web hace auto-reload cada 5 loops completos para reclamar memoria

---

## Clientes (plataformas de reproduccion)

### Browser (web)

El slideshow web funciona en cualquier browser moderno. Accede a
`https://your-domain.com/` para ver el slideshow fullscreen.

Incluye manejo agresivo de memoria para funcionar en browsers limitados
(Smart TVs): limpieza explicita de buffers de video y auto-reload periodico.

### Raspberry Pi (Flutter Linux)

App nativa Flutter con cache local, Socket.IO, y reproduccion de video
via media_kit (libmpv). Ver [`flutter_client/README.md`](flutter_client/README.md)
para instrucciones completas de setup desde cero.

```bash
cd flutter_client
flutter build linux --release
```

### Android TV — Haier, Sharp (Flutter APK)

Misma app Flutter compilada para Android. Incluye soporte para leanback
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

App web nativa empaquetada como WGT. Misma logica que la version webOS,
adaptada para Tizen APIs.
Ver [`tizen_app/README.md`](tizen_app/README.md).

```bash
cd tizen_app
tizen package -t wgt -s <perfil> -- .
tizen install -n NINJASlideshow.wgt -t <serial>
```

### Resumen de plataformas

| Plataforma | Marcas | Directorio | Compilacion | Output |
|---|---|---|---|---|
| Browser | Cualquiera | `client/` | `npm run build` | SPA (servida por Express) |
| Linux Desktop | Raspberry Pi | `flutter_client/` | `flutter build linux` | Binario nativo |
| Android TV | Haier, Sharp | `flutter_client/` | `flutter build apk` | APK |
| webOS | LG | `webos_app/` | `ares-package` | IPK |
| Tizen | Samsung | `tizen_app/` | `tizen package` | WGT |

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
