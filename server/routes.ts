import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { Server as SocketServer } from "socket.io";
import {
  S3Client,
  ListObjectsV2Command,
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
import cors from "cors";
import crypto from "crypto";
import path from "path";
import { config, cdnBaseUrl } from "./env";
import {
  adminLimiter,
  clearSession,
  isAuthenticated,
  isValidAdminPassword,
  issueSession,
  loginLimiter,
  requireAdmin,
} from "./auth";
import { log } from "./vite";

const { bucket, folder } = config.spaces;
const ORDER_KEY = `${folder}/order.json`;

const s3 = new S3Client({
  endpoint: config.spaces.endpoint,
  region: config.spaces.region,
  credentials: {
    accessKeyId: config.spaces.key,
    secretAccessKey: config.spaces.secret,
  },
  forcePathStyle: true,
});

const ALLOWED_MIME_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
};

const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".mp4",
  ".webm",
]);

/** Nombres seguros: sin separadores de ruta, sin `..`, sin caracteres raros. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()-]{0,199}$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Valida un nombre de archivo recibido del cliente y devuelve la clave S3.
 * Sin esto, un `filename` como `../otra-carpeta/x.jpg` deja escribir o borrar
 * objetos fuera de la carpeta del slideshow.
 */
function toObjectKey(filename: unknown): string {
  if (typeof filename !== "string") {
    throw new HttpError(400, "Nombre de archivo invalido");
  }
  // basename descarta cualquier ruta; la regex rechaza lo que quede raro.
  const name = path.basename(filename.trim());
  if (name !== filename.trim() || !SAFE_NAME.test(name) || name.includes("..")) {
    throw new HttpError(400, "Nombre de archivo invalido");
  }
  if (!ALLOWED_EXTENSIONS.has(path.extname(name).toLowerCase())) {
    throw new HttpError(400, "Extension de archivo no permitida");
  }
  return `${folder}/${name}`;
}

/** Acepta solo claves que ya viven dentro de la carpeta del slideshow. */
function validateObjectKey(key: unknown): string {
  if (typeof key !== "string" || !key.startsWith(`${folder}/`)) {
    throw new HttpError(400, "Clave de objeto invalida");
  }
  return toObjectKey(key.slice(folder.length + 1));
}

function validateContentType(contentType: unknown): string {
  if (typeof contentType !== "string" || !(contentType in ALLOWED_MIME_TYPES)) {
    throw new HttpError(
      400,
      `Tipo no permitido. Permitidos: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`,
    );
  }
  return contentType;
}

function validateUploadSize(size: unknown): void {
  if (size === undefined) return;
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new HttpError(400, "Tamano de archivo invalido");
  }
  if (bytes > config.maxUploadBytes) {
    throw new HttpError(
      413,
      `El archivo excede el limite de ${config.maxUploadBytes / 1024 ** 3} GB`,
    );
  }
}

/**
 * Envuelve un handler async: responde con el mensaje de HttpError cuando el
 * error es nuestro, y con un texto genérico cuando no, para no filtrar
 * detalles internos de S3 al cliente.
 */
function handler(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => void {
  return (req, res) => {
    fn(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      log(
        `${req.method} ${req.path} fallo: ${
          error instanceof Error ? error.stack ?? error.message : String(error)
        }`,
        "error",
      );
      if (!res.headersSent) {
        res.status(500).json({ error: "Error interno del servidor" });
      }
    });
  };
}

async function configureBucketCors(): Promise<void> {
  try {
    await s3.send(
      new PutBucketCorsCommand({
        Bucket: bucket,
        CORSConfiguration: {
          CORSRules: [
            {
              AllowedOrigins: ["*"],
              AllowedMethods: ["GET", "PUT", "HEAD"],
              AllowedHeaders: ["*"],
              ExposeHeaders: ["ETag"],
              MaxAgeSeconds: 3600,
            },
          ],
        },
      }),
    );
    log("CORS del bucket configurado", "spaces");
  } catch (error) {
    log(
      `No se pudo configurar el CORS del bucket: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "spaces",
    );
  }
}

export function registerRoutes(app: Express): Server {
  const httpServer = createServer(app);

  /**
   * Las apps de TV (Tizen/webOS) son paquetes locales: hacen peticiones
   * cross-origin con `Origin: null`. Solo necesitan LEER, asi que abrimos el
   * CORS unicamente en las rutas publicas y sin credenciales. Las rutas de
   * admin quedan same-origin: con `origin: true` + `credentials: true` (la
   * configuracion anterior) cualquier web podia invocarlas con la cookie del
   * admin.
   */
  const publicCors = cors({
    origin: "*",
    methods: ["GET", "HEAD"],
    credentials: false,
    maxAge: 3600,
  });

  const io = new SocketServer(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"], credentials: false },
  });

  io.on("connection", (socket) => {
    log(`pantalla conectada (${io.engine.clientsCount} en total)`, "socket");
    socket.on("disconnect", () => {
      log(`pantalla desconectada (${io.engine.clientsCount} restantes)`, "socket");
    });
  });

  if (config.configureBucketCors) {
    void configureBucketCors();
  }

  // --- Autenticacion ---

  app.post(
    "/api/login",
    loginLimiter,
    handler(async (req, res) => {
      const { password } = (req.body ?? {}) as { password?: unknown };

      if (!isValidAdminPassword(password)) {
        log(`login fallido desde ${req.ip}`, "auth");
        res.status(401).json({ error: "Contrasena incorrecta" });
        return;
      }

      issueSession(res);
      res.json({ message: "Login exitoso" });
    }),
  );

  app.post("/api/logout", (_req, res) => {
    clearSession(res);
    res.json({ message: "Sesion cerrada" });
  });

  app.get("/api/auth/status", (req, res) => {
    res.json({ authenticated: isAuthenticated(req) });
  });

  // --- Listado publico ---

  app.options("/api/files", publicCors);
  app.get(
    "/api/files",
    publicCors,
    handler(async (req, res) => {
      const listing = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: `${folder}/` }),
      );

      const files = (listing.Contents ?? [])
        .filter(
          (item) =>
            item.Key &&
            item.Size &&
            item.Size > 0 &&
            item.Key !== `${folder}/` &&
            item.Key !== ORDER_KEY,
        )
        .map((item) => {
          const version = item.LastModified
            ? Math.floor(item.LastModified.getTime() / 1000)
            : 0;
          return {
            name: path.basename(item.Key!),
            url: `${cdnBaseUrl}/${item.Key}?v=${version}`,
            type: path.extname(item.Key!).toLowerCase(),
            lastModified: item.LastModified?.toISOString(),
          };
        });

      const savedOrder = await readOrder();
      if (savedOrder) {
        const rank = new Map(savedOrder.map((name, index) => [name, index]));
        files.sort((a, b) => {
          const aRank = rank.get(a.name) ?? Number.MAX_SAFE_INTEGER;
          const bRank = rank.get(b.name) ?? Number.MAX_SAFE_INTEGER;
          return aRank - bRank || a.name.localeCompare(b.name);
        });
      } else {
        files.sort((a, b) => a.name.localeCompare(b.name));
      }

      const body = JSON.stringify(files);
      const etag = `"${crypto.createHash("sha256").update(body).digest("hex")}"`;

      res.set("Cache-Control", "no-cache");
      res.set("ETag", etag);

      if (req.headers["if-none-match"] === etag) {
        res.status(304).end();
        return;
      }

      res.type("application/json").send(body);
    }),
  );

  async function readOrder(): Promise<string[] | null> {
    try {
      const response = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: ORDER_KEY }),
      );
      const raw = await response.Body?.transformToString();
      if (!raw) return null;

      const parsed: unknown = JSON.parse(raw);
      const order = (parsed as { order?: unknown }).order;
      return Array.isArray(order)
        ? order.filter((name): name is string => typeof name === "string")
        : null;
    } catch {
      return null;
    }
  }

  // --- Subida simple con URL prefirmada (< 100 MB) ---

  app.post(
    "/api/upload/presign",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const { filename, contentType, size } = (req.body ?? {}) as Record<
        string,
        unknown
      >;
      validateUploadSize(size);
      const key = toObjectKey(filename);
      const type = validateContentType(contentType);

      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: type }),
        { expiresIn: 3600 },
      );

      res.json({ url, key });
    }),
  );

  app.post(
    "/api/upload/confirm",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const key = validateObjectKey((req.body ?? {}).key);

      await s3.send(
        new PutObjectAclCommand({
          Bucket: bucket,
          Key: key,
          ACL: "public-read",
        }),
      );

      io.emit("filesUpdated");
      res.json({ message: "Upload confirmado" });
    }),
  );

  // --- Subida multiparte (>= 100 MB) ---

  app.post(
    "/api/upload/init-multipart",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const { filename, contentType, size } = (req.body ?? {}) as Record<
        string,
        unknown
      >;
      validateUploadSize(size);
      const key = toObjectKey(filename);
      const type = validateContentType(contentType);

      const response = await s3.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: type,
          ACL: "public-read",
        }),
      );

      res.json({ uploadId: response.UploadId, key });
    }),
  );

  app.post(
    "/api/upload/presign-part",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const { key, uploadId, partNumber } = (req.body ?? {}) as Record<
        string,
        unknown
      >;
      const objectKey = validateObjectKey(key);

      if (typeof uploadId !== "string" || !uploadId) {
        throw new HttpError(400, "uploadId requerido");
      }
      const part = Number(partNumber);
      if (!Number.isInteger(part) || part < 1 || part > 10_000) {
        throw new HttpError(400, "partNumber invalido");
      }

      const url = await getSignedUrl(
        s3,
        new UploadPartCommand({
          Bucket: bucket,
          Key: objectKey,
          UploadId: uploadId,
          PartNumber: part,
        }),
        { expiresIn: 3600 },
      );

      res.json({ url });
    }),
  );

  app.post(
    "/api/upload/complete",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const { key, uploadId, parts } = (req.body ?? {}) as Record<
        string,
        unknown
      >;
      const objectKey = validateObjectKey(key);

      if (typeof uploadId !== "string" || !uploadId) {
        throw new HttpError(400, "uploadId requerido");
      }
      if (!Array.isArray(parts) || parts.length === 0) {
        throw new HttpError(400, "parts requerido");
      }

      await s3.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((entry: { partNumber: number; etag: string }) => ({
              PartNumber: entry.partNumber,
              ETag: entry.etag,
            })),
          },
        }),
      );

      io.emit("filesUpdated");
      res.json({ message: "Upload completado" });
    }),
  );

  app.post(
    "/api/upload/abort",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const { key, uploadId } = (req.body ?? {}) as Record<string, unknown>;
      const objectKey = validateObjectKey(key);

      if (typeof uploadId !== "string" || !uploadId) {
        throw new HttpError(400, "uploadId requerido");
      }

      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: objectKey,
          UploadId: uploadId,
        }),
      );

      res.json({ message: "Upload abortado" });
    }),
  );

  // --- Borrado ---

  app.delete(
    "/api/files/:filename",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const key = toObjectKey(req.params.filename);

      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        throw new HttpError(404, "Archivo no encontrado");
      }

      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      io.emit("filesUpdated");
      res.json({ message: "Archivo eliminado exitosamente" });
    }),
  );

  // --- Orden del slideshow ---

  app.post(
    "/api/order",
    adminLimiter,
    requireAdmin,
    handler(async (req, res) => {
      const { order } = (req.body ?? {}) as { order?: unknown };
      if (
        !Array.isArray(order) ||
        !order.every((name): name is string => typeof name === "string")
      ) {
        throw new HttpError(400, "Formato de orden invalido");
      }
      if (new Set(order).size !== order.length) {
        throw new HttpError(400, "El orden tiene nombres repetidos");
      }

      const listing = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, Prefix: `${folder}/` }),
      );
      const existing = new Set(
        (listing.Contents ?? [])
          .filter((item) => item.Key && item.Key !== ORDER_KEY)
          .map((item) => path.basename(item.Key!)),
      );

      if (!order.every((name) => existing.has(name))) {
        throw new HttpError(400, "Algunos archivos en el orden no existen");
      }

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: ORDER_KEY,
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
    }),
  );

  // Cualquier otra ruta /api no existe: responder JSON en lugar de caer en el
  // catch-all del SPA y devolver index.html con status 200.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Endpoint no encontrado" });
  });

  return httpServer;
}
