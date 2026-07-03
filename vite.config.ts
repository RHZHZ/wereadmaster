import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = normalizePath(dirname(fileURLToPath(import.meta.url)));
const fromRoot = (...segments: string[]) => normalizePath(resolve(projectRoot, ...segments));

export default defineConfig({
  root: projectRoot,
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: fromRoot("dist"),
    rollupOptions: {
      input: {
        app: fromRoot("index.html"),
        website: fromRoot("website/index.html")
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
