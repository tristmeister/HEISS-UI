import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const dependencies = Object.keys(packageJson.dependencies || {});
const missing = dependencies.filter((name) => !existsSync(path.join(projectRoot, "node_modules", name, "package.json")));

if (missing.length) {
  console.warn(`Missing runtime dependencies (${missing.join(", ")}). Restoring them with npm install...`);
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], {
    cwd: projectRoot,
    stdio: "inherit"
  });
}
