import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `npm start` only needs the server's own packages (express, busboy, sharp) and
// a built app in dist/. `npm run dev` (--dev) also needs the build tools, which
// live in devDependencies so a prebuilt release can install without them.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const wantDev = process.argv.includes("--dev");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const installed = (name) => existsSync(path.join(projectRoot, "node_modules", name, "package.json"));

const needed = [
  ...Object.keys(packageJson.dependencies || {}),
  ...(wantDev ? Object.keys(packageJson.devDependencies || {}) : [])
];
const missing = needed.filter((name) => !installed(name));

if (missing.length) {
  console.warn(`Missing dependencies (${missing.join(", ")}). Restoring them with npm install...`);
  // --omit=dev would also delete build tools a source checkout already has, so
  // only a release install (no vite present) skips them.
  const releaseInstall = !wantDev && !installed("vite");
  execFileSync(npm, ["install", "--no-audit", "--no-fund", ...(releaseInstall ? ["--omit=dev"] : [])], {
    cwd: projectRoot,
    stdio: "inherit"
  });
}

// A source checkout that was never built: build it now if the tools are here.
if (!wantDev && !existsSync(path.join(projectRoot, "dist", "index.html"))) {
  if (installed("vite")) {
    console.warn("No built app in dist/ yet. Building it once...");
    execFileSync(npm, ["run", "build"], { cwd: projectRoot, stdio: "inherit" });
  } else {
    console.warn("No built app in dist/. Download a release from https://github.com/tristmeister/HEISS-UI/releases, or run `npm install` and `npm run build` in a source checkout.");
  }
}
