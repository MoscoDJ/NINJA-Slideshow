import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "client", "src"),
    },
  },
  root: path.resolve(__dirname, "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    /**
     * Las pantallas corren Chromium antiguo empotrado (Tizen 5.0 ~ Chrome 63,
     * webOS 4 ~ Chrome 53, Android TV viejo). El target por defecto de Vite 7
     * asume navegadores modernos y emite sintaxis que esas TVs no parsean.
     */
    target: ["chrome61", "safari11"],
    cssTarget: ["chrome61", "safari11"],
    sourcemap: false,
  },
});
