import path from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { precompressDir } from "./scripts/precompress.mjs";

// Brotli and gzip copies of the built files, which the server sends to browsers that take them.
function precompress(): Plugin {
  let outDir = "dist";
  return {
    name: "heiss-precompress",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      precompressDir(outDir);
    }
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/(img-fx|three)\//.test(id)) return "generation-fx";
          if (id.includes("node_modules")) return "vendor";
        }
      }
    }
  },
  resolve: {
    alias: {
      "@": "/src"
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/comfy": "http://127.0.0.1:8787"
    }
  }
});
