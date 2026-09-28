import { defineConfig, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
  plugins: [react(), tailwindcss()],
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
      "/api": api,
      "/comfy": api
    }
  }
});
