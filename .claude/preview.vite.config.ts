// Dev-only preview: the normal Vite setup on port 5174, plus local ComfyUI outputs
// served from COMFY_OUTPUT_DIR so the gallery renders while ComfyUI itself is offline.
import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, mergeConfig } from "vite";
import base from "../vite.config";

const root = path.resolve(__dirname, "..");
const outputDir = path.resolve(loadEnv("development", root, "").COMFY_OUTPUT_DIR || "");
const types: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".webm": "video/webm" };

export default mergeConfig(base, defineConfig({
  root,
  server: { port: 5174, strictPort: true },
  plugins: [{
    name: "local-comfy-media",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = req.url?.match(/^\/comfy\/(?:view|thumb)\?(.*)$/);
        if (!match || !outputDir) return next();
        const query = new URLSearchParams(match[1]);
        const file = path.resolve(outputDir, query.get("subfolder") || "", query.get("filename") || "");
        if (!file.startsWith(outputDir + path.sep) || !fs.existsSync(file)) return next();
        res.setHeader("Content-Type", types[path.extname(file).toLowerCase()] || "application/octet-stream");
        fs.createReadStream(file).pipe(res);
      });
    },
  }],
}));
