import express, { type Express } from "express";
import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { type Server } from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function log(message: string, source = "express"): void {
  const time = new Date().toISOString();
  console.log(`${time} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server): Promise<void> {
  const { createServer: createViteServer } = await import("vite");

  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: "custom",
  });

  app.use(vite.middlewares);

  // Catch-all del SPA. Express 5 usa path-to-regexp v8, donde el patron "*"
  // suelto ya no es valido: se registra sin ruta.
  app.use(async (req, res, next) => {
    try {
      const template = await fs.promises.readFile(
        path.resolve(__dirname, "..", "client", "index.html"),
        "utf-8",
      );
      const page = await vite.transformIndexHtml(req.originalUrl, template);
      res.status(200).type("html").end(page);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

export function serveStatic(app: Express): void {
  const distPath = path.resolve(__dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `No existe el directorio de build: ${distPath}. Corre 'npm run build' primero.`,
    );
  }

  // Los assets con hash en el nombre son inmutables; el resto se revalida.
  app.use(
    express.static(distPath, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
