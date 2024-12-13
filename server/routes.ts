// server/routes.ts
import type { Express } from "express";
import { createServer, type Server } from "http";
import { Server as SocketServer } from "socket.io";
import multer from "multer";
import aws from "aws-sdk";
import path from "path";

const BUCKET_NAME = process.env.BUCKET_NAME || 'ninjacdn';
const FOLDER_NAME = 'slideshow';

// Verificar y configurar las credenciales
if (!process.env.SPACES_KEY || !process.env.SPACES_SECRET_KEY) {
  console.error('ERROR: Faltan las credenciales de Digital Ocean Spaces');
  console.error('Credenciales requeridas:');
  console.error('- SPACES_KEY:', process.env.SPACES_KEY ? '✓' : '✗');
  console.error('- SPACES_SECRET_KEY:', process.env.SPACES_SECRET_KEY ? '✓' : '✗');
  throw new Error('Faltan las credenciales de Digital Ocean Spaces');
}

// Configurar endpoint y región
const spacesEndpoint = new aws.Endpoint('sfo3.digitaloceanspaces.com');
const region = 'sfo3';

// Configuración de AWS SDK con debugging
const s3 = new aws.S3({
  endpoint: spacesEndpoint,
  accessKeyId: 'DO00W9GMLURV8XLYH79K',
  secretAccessKey: 'oWPynHfA75gTmd1AH6qZ4RwRbRFPXOOm5X+ynIWC4jo',
  region: region,
  signatureVersion: 'v4',
  s3ForcePathStyle: true,
  computeChecksums: true,
  logger: console,
  httpOptions: {
    timeout: 10000,
    agent: false
  }
});

// Log de configuración (sin exponer credenciales)
console.log('Configuración de S3:', {
  endpoint: spacesEndpoint.href,
  region: region,
  hasAccessKeyId: !!process.env.SPACES_KEY,
  hasSecretAccessKey: !!process.env.SPACES_SECRET_KEY
});

// Multer config
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('disconnect', () => console.log('Client disconnected'));
  });

  // Get files list
  app.get('/api/files', async (req, res) => {
    try {
      // Verificar configuración
      if (!process.env.SPACES_KEY || !process.env.SPACES_SECRET_KEY || !BUCKET_NAME) {
        console.error('Error: Faltan variables de entorno necesarias');
        return res.status(500).json({ 
          error: 'Configuración incompleta',
          details: {
            SPACES_KEY: !!process.env.SPACES_KEY,
            SPACES_SECRET_KEY: !!process.env.SPACES_SECRET_KEY,
            BUCKET_NAME: !!BUCKET_NAME
          }
        });
      }

      // Verificar que el bucket existe
      try {
        const listBucketsData = await s3.listBuckets().promise();
        const bucketExists = listBucketsData.Buckets?.some(bucket => bucket.Name === BUCKET_NAME);
        
        if (!bucketExists) {
          console.error(`Bucket '${BUCKET_NAME}' no encontrado`);
          return res.status(404).json({ error: 'Bucket not found' });
        }
      } catch (bucketError: any) {
        console.error('Error al verificar el bucket:', bucketError);
        return res.status(500).json({ 
          error: 'Error de autenticación',
          details: bucketError.code
        });
      }

      const params = {
        Bucket: BUCKET_NAME!,
        Prefix: FOLDER_NAME + '/'
      };
      
      const data = await s3.listObjects(params).promise();
      const files = data.Contents
        ?.filter(item => item?.Size > 0)
        .map(item => ({
          name: path.basename(item.Key as string),
          url: `https://${BUCKET_NAME}.${spacesEndpoint.hostname}/${item.Key}`,
          type: path.extname(item.Key as string).toLowerCase()
        })) || [];
      
      res.json(files);
    } catch (error: any) {
      console.error('Error al listar archivos:', error);
      const errorMessage = error.code === 'CredentialsError' 
        ? 'Error de autenticación con Digital Ocean Spaces'
        : error.message;
      res.status(500).json({ error: errorMessage });
    }
  });

  // Upload file
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        throw new Error('No file uploaded');
      }

      const params = {
        Bucket: BUCKET_NAME,
        Key: `${FOLDER_NAME}/${req.file.originalname}`,
        Body: req.file.buffer,
        ACL: 'public-read',
        ContentType: req.file.mimetype
      };
      
      await s3.upload(params).promise();
      io.emit('filesUpdated');
      res.json({ message: 'File uploaded successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Delete file
  app.delete('/api/files/:filename', async (req, res) => {
    try {
      const params = {
        Bucket: BUCKET_NAME,
        Key: `${FOLDER_NAME}/${req.params.filename}`
      };
      
      await s3.deleteObject(params).promise();
      io.emit('filesUpdated');
      res.json({ message: 'File deleted successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Update order
  app.post('/api/order', async (req, res) => {
    try {
      // Order update is handled client-side for now
      io.emit('filesUpdated');
      res.json({ message: 'Order updated successfully' });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}