import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { Server as SocketServer } from "socket.io";
import {
  S3Client,
  ListBucketsCommand,
  ListObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  PutObjectAclCommand,
  PutBucketCorsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import path from "path";
import crypto from "crypto";
import cors from "cors";

declare module "express-session" {
  interface SessionData {
    isAdmin: boolean;
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isAdmin) {
    return next();
  }
  res.status(401).json({ error: "No autorizado" });
}

const BUCKET_NAME = process.env.BUCKET_NAME || "ninjacdn";
const FOLDER_NAME = "slideshow";
const SPACES_REGION = "sfo3";
const SPACES_HOST = `${SPACES_REGION}.digitaloceanspaces.com`;

if (!process.env.SPACES_KEY || !process.env.SPACES_SECRET_KEY) {
  console.error("ERROR: Missing Digital Ocean Spaces credentials");
  throw new Error("Missing Digital Ocean Spaces credentials");
}

const s3 = new S3Client({
  endpoint: `https://${SPACES_HOST}`,
  region: SPACES_REGION,
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET_KEY,
  },
  forcePathStyle: true,
});

console.log("S3 configuration:", {
  endpoint: `https://${SPACES_HOST}`,
  region: SPACES_REGION,
  bucket: BUCKET_NAME,
});

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
];

async function configureBucketCors() {
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: BUCKET_NAME,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["*"],
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["*"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    console.log("Bucket CORS configured successfully");
  } catch (err: any) {
    console.warn("Could not set bucket CORS (may require manual config):", err.message);
  }
}

configureBucketCors();

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  const corsOptions = {
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  };

  app.use(cors(corsOptions));

  const io = new SocketServer(httpServer, { cors: corsOptions });

  io.on("connection", (socket) => {
    console.log("Client connected");
    socket.on("disconnect", () => console.log("Client disconnected"));
  });

  // --- Auth ---

  app.post("/api/login", (req, res) => {
    const { password } = req.body;
    const passwords = [
      process.env.ADMIN_PASSWORD,
      process.env.ADMIN2_PASSWORD,
    ].filter(Boolean);

    if (passwords.length === 0) {
      console.error("No ADMIN_PASSWORD environment variables are set");
      return res
        .status(500)
        .json({ error: "Configuración de autenticación incompleta" });
    }

    if (passwords.includes(password)) {
      req.session.isAdmin = true;
      return res.json({ message: "Login exitoso" });
    }

    res.status(401).json({ error: "Contraseña incorrecta" });
  });

  app.post("/api/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err)
        return res
          .status(500)
          .json({ error: "Error al cerrar sesión" });
      res.clearCookie("connect.sid");
      res.json({ message: "Sesión cerrada" });
    });
  });

  app.get("/api/auth/status", (req, res) => {
    res.json({ authenticated: !!req.session?.isAdmin });
  });

  // --- Files listing ---

  app.get("/api/files", async (req, res) => {
    try {
      const bucketsResp = await s3.send(new ListBucketsCommand({}));
      if (!bucketsResp.Buckets?.some((b) => b.Name === BUCKET_NAME)) {
        return res.status(404).json({ error: "Bucket not found" });
      }

      const data = await s3.send(
        new ListObjectsCommand({
          Bucket: BUCKET_NAME,
          Prefix: FOLDER_NAME + "/",
        }),
      );

      let files =
        data.Contents?.filter(
          (item) =>
            item.Size &&
            item.Size > 0 &&
            item.Key !== `${FOLDER_NAME}/` &&
            !item.Key?.endsWith("order.json"),
        ).map((item) => {
          const ts = item.LastModified
            ? Math.floor(item.LastModified.getTime() / 1000)
            : 0;
          return {
            name: path.basename(item.Key!),
            url: `https://${BUCKET_NAME}.${SPACES_HOST}/${item.Key}?v=${ts}`,
            type: path.extname(item.Key!).toLowerCase(),
            lastModified: item.LastModified?.toISOString(),
          };
        }) || [];

      try {
        const orderResp = await s3.send(
          new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: `${FOLDER_NAME}/order.json`,
          }),
        );
        const bodyStr = await orderResp.Body?.transformToString();
        if (bodyStr) {
          const savedOrder: string[] = JSON.parse(bodyStr).order;
          files.sort((a, b) => {
            const aIdx = savedOrder.indexOf(a.name);
            const bIdx = savedOrder.indexOf(b.name);
            if (aIdx === -1) return 1;
            if (bIdx === -1) return -1;
            return aIdx - bIdx;
          });
        }
      } catch {
        files.sort((a, b) => a.name.localeCompare(b.name));
      }

      const body = JSON.stringify(files);
      const etag = `"${crypto.createHash("md5").update(body).digest("hex")}"`;

      res.set("Cache-Control", "no-cache");
      res.set("ETag", etag);

      if (req.headers["if-none-match"] === etag) {
        return res.status(304).end();
      }

      res.json(files);
    } catch (error: any) {
      console.error("Error listing files:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Presigned upload (simple, < 100 MB) ---

  app.post("/api/upload/presign", requireAdmin, async (req, res) => {
    try {
      const { filename, contentType } = req.body;
      if (!filename || !contentType) {
        return res
          .status(400)
          .json({ error: "filename and contentType are required" });
      }
      if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        return res.status(400).json({
          error: `Tipo no permitido. Permitidos: ${ALLOWED_MIME_TYPES.join(", ")}`,
        });
      }

      const key = `${FOLDER_NAME}/${filename}`;
      const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        ContentType: contentType,
      });

      const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
      res.json({ url, key });
    } catch (error: any) {
      console.error("Error generating presigned URL:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // Confirm upload — sets ACL to public-read and notifies clients
  app.post("/api/upload/confirm", requireAdmin, async (req, res) => {
    try {
      const { key } = req.body;
      if (key) {
        await s3.send(
          new PutObjectAclCommand({
            Bucket: BUCKET_NAME,
            Key: key,
            ACL: "public-read",
          }),
        );
      }
      io.emit("filesUpdated");
      res.json({ message: "Upload confirmed" });
    } catch (error: any) {
      console.error("Error confirming upload:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Multipart upload (>= 100 MB) ---

  app.post("/api/upload/init-multipart", requireAdmin, async (req, res) => {
    try {
      const { filename, contentType } = req.body;
      if (!filename || !contentType) {
        return res
          .status(400)
          .json({ error: "filename and contentType are required" });
      }
      if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        return res.status(400).json({
          error: `Tipo no permitido. Permitidos: ${ALLOWED_MIME_TYPES.join(", ")}`,
        });
      }

      const key = `${FOLDER_NAME}/${filename}`;
      const resp = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          ContentType: contentType,
          ACL: "public-read",
        }),
      );

      res.json({ uploadId: resp.UploadId, key });
    } catch (error: any) {
      console.error("Error initiating multipart upload:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/upload/presign-part", requireAdmin, async (req, res) => {
    try {
      const { key, uploadId, partNumber } = req.body;
      if (!key || !uploadId || !partNumber) {
        return res
          .status(400)
          .json({ error: "key, uploadId, and partNumber are required" });
      }

      const command = new UploadPartCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
      res.json({ url });
    } catch (error: any) {
      console.error("Error generating part presigned URL:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/upload/complete", requireAdmin, async (req, res) => {
    try {
      const { key, uploadId, parts } = req.body;
      if (!key || !uploadId || !Array.isArray(parts)) {
        return res
          .status(400)
          .json({ error: "key, uploadId, and parts are required" });
      }

      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map(
              (p: { partNumber: number; etag: string }) => ({
                PartNumber: p.partNumber,
                ETag: p.etag,
              }),
            ),
          },
        }),
      );

      io.emit("filesUpdated");
      res.json({ message: "Upload completed" });
    } catch (error: any) {
      console.error("Error completing multipart upload:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/upload/abort", requireAdmin, async (req, res) => {
    try {
      const { key, uploadId } = req.body;
      if (!key || !uploadId) {
        return res
          .status(400)
          .json({ error: "key and uploadId are required" });
      }

      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          UploadId: uploadId,
        }),
      );

      res.json({ message: "Upload aborted" });
    } catch (error: any) {
      console.error("Error aborting multipart upload:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // --- Delete file ---

  app.delete("/api/files/:filename", requireAdmin, async (req, res) => {
    try {
      const key = `${FOLDER_NAME}/${req.params.filename}`;

      try {
        await s3.send(
          new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
        );
      } catch {
        return res.status(404).json({ error: "Archivo no encontrado" });
      }

      await s3.send(
        new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
      );
      io.emit("filesUpdated");
      res.json({ message: "Archivo eliminado exitosamente" });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // --- Update order ---

  app.post("/api/order", requireAdmin, async (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order)) {
        throw new Error("Formato de orden inválido");
      }

      const listing = await s3.send(
        new ListObjectsCommand({
          Bucket: BUCKET_NAME,
          Prefix: FOLDER_NAME + "/",
        }),
      );
      const existingNames =
        listing.Contents?.map((item) => path.basename(item.Key!)) || [];
      if (!order.every((f: string) => existingNames.includes(f))) {
        throw new Error("Algunos archivos en el orden no existen");
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: `${FOLDER_NAME}/order.json`,
          Body: JSON.stringify(
            { order, updatedAt: new Date().toISOString() },
            null,
            2,
          ),
          ContentType: "application/json",
          ACL: "public-read",
        }),
      );

      io.emit("filesUpdated");
      res.json({ message: "Orden actualizado exitosamente", order });
    } catch (error: any) {
      console.error("Error updating order:", error);
      res.status(500).json({ error: error.message });
    }
  });

  return httpServer;
}
