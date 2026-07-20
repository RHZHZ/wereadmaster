import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = normalizePath(dirname(fileURLToPath(import.meta.url)));
const fromRoot = (...segments: string[]) => normalizePath(resolve(projectRoot, ...segments));

export default defineConfig({
  root: fromRoot("website"),
  base: "./",
  plugins: [react()],
  clearScreen: false,
  build: {
    outDir: fromRoot("dist-website"),
    emptyOutDir: true
  }
});
