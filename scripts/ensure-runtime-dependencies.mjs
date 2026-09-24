import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `npm start` only needs the server's own packages (express, busboy, sharp) and
// a built app in dist/. `npm run dev` (--dev) also needs the build tools, which
// live in devDependencies so a prebuilt release can install without them.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const wantDev = process.argv.includes("--dev");
// npm is npm.cmd on Windows, which Node (since the CVE-2024-27980 fix) only
// runs through a shell. Under `npm start` npm's own script is known, so run
// that with this Node; otherwise (the .bat launcher) go through the shell.
function runNpm(args, options) {
  const cli = process.env.npm_execpath;
  if (cli && /npm-cli\.[cm]?js$/.test(cli)) return execFileSync(process.execPath, [cli, ...args], options);
  if (process.platform === "win32") return execSync(`npm ${args.join(" ")}`, options);
  return execFileSync("npm", args, options);
}
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
  runNpm(["install", "--no-audit", "--no-fund", ...(releaseInstall ? ["--omit=dev"] : [])], {
    cwd: projectRoot,
    stdio: "inherit"
  });
}

// A source checkout that was never built: build it now if the tools are here.
if (!wantDev && !existsSync(path.join(projectRoot, "dist", "index.html"))) {
  if (installed("vite")) {
    console.warn("No built app in dist/ yet. Building it once...");
    runNpm(["run", "build"], { cwd: projectRoot, stdio: "inherit" });
  } else {
    console.warn("No built app in dist/. Download a release from https://github.com/tristmeister/HEISS-UI/releases, or run `npm install` and `npm run build` in a source checkout.");
  }
}
