import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `npm start` only needs the server's own packages (express, busboy, sharp) and
// a built app in dist/. `npm run dev` (--dev) also needs the build tools, which
// live in devDependencies so a prebuilt release can install without them.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const wantDev = process.argv.includes("--dev");
// npm's own script: the one `npm start` ran, else the npm that ships next to this
// node (Node's Windows zip, which a Windows download brings, and most installs).
function npmCli() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
  ];
  return candidates.find((file) => file && /npm-cli\.[cm]?js$/.test(file) && existsSync(file)) || "";
}

// npm is npm.cmd on Windows, which Node (since the CVE-2024-27980 fix) only
// runs through a shell. Under `npm start` npm's own script is known, so run
// that with this Node; otherwise (the .bat launcher) go through the shell.
function runNpm(args, options) {
  const cli = npmCli();
  if (cli) return execFileSync(process.execPath, [cli, ...args], options);
  if (process.platform === "win32") return execSync(`npm ${args.join(" ")}`, options);
  return execFileSync("npm", args, options);
}
const installed = (name) => existsSync(path.join(projectRoot, "node_modules", name, "package.json"));

const needed = [
  ...Object.keys(packageJson.dependencies || {}),
  ...(wantDev ? Object.keys(packageJson.devDependencies || {}) : [])
];
const missing = needed.filter((name) => !installed(name));
// A download bundles sharp's native binary for one platform. Unpacked on another
// (say the Windows zip on a Mac), sharp would not load, so fetch this one's.
// Best effort: without a network the app still starts, just without thumbnails.
const nativeSharp = { win32: [`sharp-win32-${process.arch}`], darwin: [`sharp-darwin-${process.arch}`], linux: [`sharp-linux-${process.arch}`, `sharp-linuxmusl-${process.arch}`] }[process.platform];
const wrongPlatform = !missing.length && installed("sharp") && nativeSharp && !nativeSharp.some((name) => installed(`@img/${name}`));

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

if (wrongPlatform) {
  console.warn(`These packages were installed for another system. Fetching the image library for this one (${process.platform} ${process.arch})...`);
  const releaseInstall = !wantDev && !installed("vite");
  try {
    runNpm(["install", "--no-audit", "--no-fund", ...(releaseInstall ? ["--omit=dev"] : [])], { cwd: projectRoot, stdio: "inherit" });
  } catch (error) {
    console.warn(`Could not fetch it (${error.message}). HEISS UI starts anyway; thumbnails fall back to full images.`);
  }
}

// The video encoder for grid previews (ffmpeg-static) is an optional package:
// its binary is downloaded from GitHub when it installs, and if that download
// fails (offline, a firewall) npm leaves it out without a word and nothing
// would ever try again. So: put the binary back if only it is missing, and
// install the package again if it is missing, at most once a day so a computer
// without internet doesn't wait at every start. A system ffmpeg makes it moot.
const encoderBinary = path.join(projectRoot, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const encoderWanted = Boolean(packageJson.optionalDependencies?.["ffmpeg-static"] || packageJson.dependencies?.["ffmpeg-static"]);
const systemEncoder = () => {
  if (process.env.HEISS_FFMPEG_PATH) return true;
  try { return spawnSync("ffmpeg", ["-version"], { stdio: "ignore", timeout: 5000, windowsHide: true }).status === 0; } catch { return false; }
};
const encoderStamp = path.join(projectRoot, "node_modules", ".heiss-encoder-attempt");
const triedToday = () => { try { return Date.now() - statSync(encoderStamp).mtimeMs < 24 * 60 * 60 * 1000; } catch { return false; } };
if (encoderWanted && !existsSync(encoderBinary) && !systemEncoder() && !triedToday()) {
  try { writeFileSync(encoderStamp, new Date().toISOString()); } catch { /* no node_modules yet: npm makes it */ }
  const releaseInstall = !wantDev && !installed("vite");
  try {
    if (installed("ffmpeg-static")) runNpm(["rebuild", "ffmpeg-static", "--no-audit", "--no-fund"], { cwd: projectRoot, stdio: "inherit" });
    else {
      console.warn("The video preview encoder is missing. Installing it...");
      runNpm(["install", "--no-audit", "--no-fund", ...(releaseInstall ? ["--omit=dev"] : [])], { cwd: projectRoot, stdio: "inherit" });
    }
  } catch (error) {
    console.warn(`Could not install the video preview encoder (${error.message}). Videos still open; grid tiles show a placeholder. It's tried again tomorrow, or install ffmpeg yourself.`);
  }
  if (!existsSync(encoderBinary)) console.warn("No video preview encoder yet. Videos still open; grid tiles show a placeholder until it's installed (or ffmpeg is on the PATH).");
}

// A source checkout started with the launcher builds the app itself: when it
// was never built, and when anything the page is built from changed since the
// last build (a `git pull`, an edit). Otherwise the server would run the new
// code and the browser would still get the old page.
const builtAt = (() => { try { return statSync(path.join(projectRoot, "dist", "index.html")).mtimeMs; } catch { return 0; } })();
function newestSource() {
  let newest = 0;
  const visit = (target) => {
    let stat;
    try { stat = statSync(target); } catch { return; }
    if (stat.isDirectory()) { for (const name of readdirSync(target)) visit(path.join(target, name)); return; }
    newest = Math.max(newest, stat.mtimeMs);
  };
  for (const entry of ["src", "public", "index.html", "vite.config.ts", "package-lock.json"]) visit(path.join(projectRoot, entry));
  return newest;
}
const sourceCheckout = existsSync(path.join(projectRoot, "src"));
if (!wantDev && builtAt && sourceCheckout && installed("vite") && newestSource() > builtAt) {
  console.warn("The app changed since it was last built. Building it again...");
  try {
    runNpm(["run", "build"], { cwd: projectRoot, stdio: "inherit" });
  } catch (error) {
    console.warn(`The build failed (${error.message}). Starting with the previous build.`);
  }
} else if (!wantDev && !existsSync(path.join(projectRoot, "dist", "index.html"))) {
  if (installed("vite")) {
    console.warn("No built app in dist/ yet. Building it once...");
    runNpm(["run", "build"], { cwd: projectRoot, stdio: "inherit" });
  } else {
    console.warn("No built app in dist/. Download a release from https://github.com/tristmeister/HEISS-UI/releases, or run `npm install` and `npm run build` in a source checkout.");
  }
}
