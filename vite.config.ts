import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = normalizePath(realpathSync.native(dirname(fileURLToPath(import.meta.url))));
const fromRoot = (...segments: string[]) => normalizePath(resolve(projectRoot, ...segments));
const toastRuntimeId = fromRoot("src", "components", "ToastProvider.tsx");
const TOAST_RUNTIME_ERROR = "useToast must be used within ToastProvider.";

function canonicalizeToastRuntimeId(): Plugin {
  return {
    name: "canonicalize-toast-runtime-id",
    enforce: "pre",
    resolveId(source) {
      const normalizedSource = normalizePath(source).toLowerCase();
      if (
        normalizedSource.endsWith("/toastprovider") ||
        normalizedSource.endsWith("/toastprovider.tsx")
      ) {
        return toastRuntimeId;
      }

      return null;
    }
  };
}

function assertToastRuntimeSingleton(): Plugin {
  return {
    name: "assert-toast-runtime-singleton",
    apply: "build",
    generateBundle(_options, bundle) {
      const toastRuntimeChunks = Object.values(bundle).filter(
        (output) => output.type === "chunk" && output.code.includes(TOAST_RUNTIME_ERROR)
      );
      const hookOccurrences = toastRuntimeChunks.reduce(
        (count, output) => count + output.code.split(TOAST_RUNTIME_ERROR).length - 1,
        0
      );
      const contextOccurrences = toastRuntimeChunks.reduce(
        (count, output) => count + (output.code.match(/\.createContext\(/g)?.length ?? 0),
        0
      );

      if (
        toastRuntimeChunks.length !== 1 ||
        hookOccurrences !== 1 ||
        contextOccurrences !== 1
      ) {
        const moduleIds = toastRuntimeChunks.flatMap((output) => Object.keys(output.modules));
        this.error(
          "Toast runtime singleton check failed: " +
            `expected one runtime chunk, hook and Context; found ${toastRuntimeChunks.length} chunk(s), ` +
            `${hookOccurrences} hook(s) and ${contextOccurrences} Context(s). ` +
            `Runtime module IDs: ${moduleIds.join(", ") || "none"}.`
        );
      }
    }
  };
}

export default defineConfig({
  root: projectRoot,
  base: "./",
  plugins: [react(), canonicalizeToastRuntimeId(), assertToastRuntimeSingleton()],
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

          if (normalizedId.toLowerCase() === toastRuntimeId.toLowerCase()) {
            return "toast-runtime";
          }

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
