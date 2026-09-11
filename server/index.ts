import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import helmet from "helmet";
import compression from "compression";
import { config } from "./env";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";

const app = express();

// Solo confiamos en el numero de proxies declarado: con `true` cualquiera
// podria falsear X-Forwarded-For y esquivar el rate limit del login.
app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");

const spacesOrigin = config.spaces.endpoint;
const cdnOrigin = `https://${config.spaces.bucket}.${config.spaces.cdnHost}`;

app.use(
  helmet({
    // Los recursos publicos (/api/files) los leen las apps de TV desde otro
    // origen, asi que no podemos marcarlos como same-origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Vite en desarrollo necesita eval e inline para el HMR; la CSP estricta
    // solo aplica al bundle de produccion.
    contentSecurityPolicy: config.isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            // React escribe estilos inline en atributos style.
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:", cdnOrigin],
            mediaSrc: ["'self'", "blob:", cdnOrigin],
            // socket.io usa websockets al propio origen; las subidas van
            // directo a Spaces con URL prefirmada.
            connectSrc: ["'self'", "ws:", "wss:", spacesOrigin, cdnOrigin],
            fontSrc: ["'self'", "data:"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
            upgradeInsecureRequests: [],
          },
        }
      : false,
  }),
);

app.use(compression());
// Los cuerpos JSON de esta API son metadatos pequenos; el contenido pesado va
// directo a Spaces. Un limite bajo evita abuso de memoria.
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "256kb" }));

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) return next();

  const start = Date.now();
  res.on("finish", () => {
    log(
      `${req.method} ${req.path} ${res.statusCode} in ${Date.now() - start}ms`,
    );
  });
  next();
});

async function main(): Promise<void> {
  const server = registerRoutes(app);

  if (config.isProd) {
    serveStatic(app);
  } else {
    await setupVite(app, server);
  }

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status =
      typeof err === "object" && err !== null && "status" in err
        ? Number((err as { status: unknown }).status) || 500
        : 500;

    log(
      `${req.method} ${req.path} -> ${status}: ${
        err instanceof Error ? err.stack ?? err.message : String(err)
      }`,
      "error",
    );

    if (res.headersSent) return;
    res.status(status).json({
      error: status >= 500 ? "Error interno del servidor" : "Peticion invalida",
    });
    // El handler anterior hacia `throw err` aqui, lo que tumbaba el proceso
    // en cada error 500. Ahora solo se registra.
  });

  server.listen(config.port, "0.0.0.0", () => {
    log(`escuchando en el puerto ${config.port} (${config.isProd ? "produccion" : "desarrollo"})`);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      log(`${signal} recibido, cerrando servidor`);
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
}

main().catch((error: unknown) => {
  log(
    `no se pudo arrancar: ${
      error instanceof Error ? error.message : String(error)
    }`,
    "fatal",
  );
  process.exit(1);
});
