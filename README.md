# Digital Slideshow System

Sistema de slideshow digital con gestión de contenidos en tiempo real usando Digital Ocean Spaces.

## Características

- Subida y gestión de imágenes y videos
- Ordenamiento de contenido mediante drag & drop
- Actualización en tiempo real usando WebSockets
- Almacenamiento en Digital Ocean Spaces
- Interfaz de administración intuitiva
- Soporte para imágenes (JPEG, PNG, GIF, WebP) y videos (MP4, WebM)

## Requisitos

- Node.js 20.x o superior
- Digital Ocean Spaces bucket configurado
- Variables de entorno configuradas (ver .env.example)

## Instalación Local

1. Clonar el repositorio:
```bash
git clone <repository-url>
cd digital-slideshow
```

2. Instalar dependencias:
```bash
npm install
```

3. Copiar el archivo de ejemplo de variables de entorno:
```bash
cp .env.example .env
```

4. Configurar las variables de entorno en el archivo `.env`:
```
SPACES_ENDPOINT=your-region.digitaloceanspaces.com
BUCKET_NAME=your-bucket-name
SPACES_KEY=your-spaces-key
SPACES_SECRET_KEY=your-spaces-secret-key
```

5. Iniciar la aplicación:
```bash
npm run dev
```

## Despliegue en Digital Ocean

### Preparación del Spaces Bucket

1. Crear un nuevo Space en Digital Ocean:
   - Ir a la sección Spaces en Digital Ocean
   - Elegir una región (preferiblemente cercana a tus usuarios)
   - Crear un nuevo bucket
   - Habilitar CDN (opcional, pero recomendado)

2. Configurar las credenciales de acceso:
   - Ir a API > Spaces keys
   - Generar nuevas credenciales de acceso
   - Guardar el Access Key y Secret Key de forma segura

### Despliegue de la Aplicación

1. Crear una nueva App en Digital Ocean:
   - Ir a Apps > Create App
   - Seleccionar el repositorio de GitHub
   - Elegir la rama principal (main/master)

2. Configurar el entorno:
   - Seleccionar Node.js como Environment
   - Configurar el comando de build: `npm run build`
   - Configurar el comando de run: `npm start`
   - Puerto: 3000

3. Configurar las variables de entorno:
   - SPACES_ENDPOINT=region.digitaloceanspaces.com
   - BUCKET_NAME=your-bucket-name
   - SPACES_KEY=your-spaces-key
   - SPACES_SECRET_KEY=your-spaces-secret-key
   - NODE_ENV=production
   - PORT=3000

4. Revisar y desplegar:
   - Verificar la configuración
   - Iniciar el despliegue
   - Esperar a que el proceso de build y deploy termine

## Uso

- Acceder a la interfaz de administración: `https://your-app-url/admin`
- Ver el slideshow: `https://your-app-url/`

## Mantenimiento

Para actualizar la aplicación:
1. Hacer push de los cambios a GitHub
2. Digital Ocean automáticamente detectará los cambios
3. Se iniciará un nuevo despliegue automático

## Licencia

MIT
