import path from "node:path";
import { defineConfig, type Plugin, type ProxyOptions } from "vite";
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

// `npm run dev` (scripts/dev.mjs) hands Vite and the server one token, so the
// server can tell a phone on the network from this computer even though every
// proxied request reaches it from 127.0.0.1 (see server/client-trust.js).
const devProxyToken = process.env.HEISS_DEV_PROXY_TOKEN || "";
const api: ProxyOptions = {
  target: "http://127.0.0.1:8787",
  configure(proxy) {
    if (!devProxyToken) return;
    proxy.on("proxyReq", (proxyReq, req) => {
      proxyReq.setHeader("x-heiss-dev-client", req.socket.remoteAddress || "");
      proxyReq.setHeader("x-heiss-dev-token", devProxyToken);
    });
  }
};

export default defineConfig({
  plugins: [react(), tailwindcss(), precompress()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Shared import helpers must not pull the lazy player into the entry chunk.
          if (id.includes('vite/preload-helper') || id.includes('commonjsHelpers')) return 'vendor';
          if (/node_modules\/(@videojs\/|react-compiler-runtime\/)/.test(id)) return "video-player";
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
      "/api": api,
      "/comfy": api
    }
  }
});
