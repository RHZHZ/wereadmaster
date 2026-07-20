import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = normalizePath(dirname(fileURLToPath(import.meta.url)));
const fromRoot = (...segments: string[]) => normalizePath(resolve(projectRoot, ...segments));

export default defineConfig({
  root: projectRoot,
  base: "./",
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: fromRoot("dist"),
    rollupOptions: {
      input: {
        app: fromRoot("index.html"),
        website: fromRoot("website/index.html")
      },
      output: {
        manualChunks(id) {
          const normalizedId = normalizePath(id);

          if (!normalizedId.includes("/node_modules/")) {
            return undefined;
          }

          if (
            normalizedId.includes("/node_modules/react/") ||
            normalizedId.includes("/node_modules/react-dom/") ||
            normalizedId.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          if (normalizedId.includes("/node_modules/lucide-react/")) {
            return "icons";
          }

          if (normalizedId.includes("/node_modules/@tauri-apps/")) {
            return "tauri";
          }

          return "vendor";
        }
      }
    }
  },
  server: {
    host: process.env.TAURI_DEV_HOST ? "0.0.0.0" : "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  envPrefix: ["VITE_", "TAURI_"]
});
