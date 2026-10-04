// Assembles a ready-to-run HEISS UI release from an already built checkout:
// the built app (dist/), the server, bundled workflows and the lockfile, but no
// sources, tests or build tools. Users unpack it and run the launcher, which
// goes through scripts/start.mjs: it swaps in updates and restarts the server
// on request.
//
//   npm run build && node scripts/package-release.mjs
//
// Writes release/heiss-ui-<version>/ and these zips:
//   heiss-ui-<version>.zip               what the in-app updater downloads (no packages)
//   heiss-ui-<version>-<platform>.zip    the downloads, runtime packages and Node.js included
// and, with a signing key, a .sig beside the updater's zip (server/release-signing.js).
// The downloads carry no .sig: nothing checks one, and GitHub shows each file's SHA-256.
// The key comes from HEISS_RELEASE_SIGNING_KEY (the PEM itself, as CI has it)
// or HEISS_RELEASE_SIGNING_KEY_FILE (a path, for a local build).
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { downloadVerified, publishedSha256, runtimeArchive, runtimeFolder } from "../server/node-runtime.js";
import { DESKTOP_ENTRY, foreignLauncher, LAUNCHER_FILES, LAUNCHERS } from "../server/release-swap.js";
import { desktopEntry, shellLauncher, windowsLauncher } from "./launchers.mjs";
import { publicKeyLine, releasePublicKey, signRelease, verifyReleaseSignature } from "../server/release-signing.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const name = `heiss-ui-${pkg.version}`;
const outDir = path.join(root, "release");
const target = path.join(outDir, name);

if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.error("dist/ is missing. Run `npm run build` first.");
  process.exit(1);
}

// Signing, decided before anything is built: a release that installed copies
// would refuse must not be published by accident.
const signingKey = (() => {
  if (process.env.HEISS_RELEASE_SIGNING_KEY) return process.env.HEISS_RELEASE_SIGNING_KEY;
  const file = process.env.HEISS_RELEASE_SIGNING_KEY_FILE;
  return file ? fs.readFileSync(file, "utf8") : "";
})();
const trustedKey = releasePublicKey();
const publishing = /^refs\/tags\//.test(process.env.GITHUB_REF || "");
if (signingKey && trustedKey && publicKeyLine(signingKey) !== trustedKey) {
  console.error("The signing key does not match RELEASE_PUBLIC_KEY in server/release-signing.js; installed copies would refuse this release.");
  process.exit(1);
}
if (!signingKey && trustedKey) {
  if (publishing) {
    console.error("RELEASE_PUBLIC_KEY is set but HEISS_RELEASE_SIGNING_KEY is not: copies with that key refuse unsigned releases. Add the secret (see scripts/release-keygen.mjs).");
    process.exit(1);
  }
  console.warn("No signing key: this package is unsigned, so installed copies won't install it by themselves.");
}

/** Writes <zip>.sig and checks it the way the updater will. */
function signZip(zip, sha256) {
  fs.rmSync(`${zip}.sig`, { force: true });
  if (!signingKey) return "";
  const sig = signRelease({ version: pkg.version, file: path.basename(zip), sha256, privateKeyPem: signingKey });
  verifyReleaseSignature({ sig, version: pkg.version, file: path.basename(zip), sha256, publicKey: trustedKey || publicKeyLine(signingKey) });
  fs.writeFileSync(`${zip}.sig`, sig);
  return " and signed";
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

const copy = (from, filter = () => true) => {
  fs.cpSync(path.join(root, from), path.join(target, from), {
    recursive: true,
    filter: (src) => filter(path.relative(root, src))
  });
};

copy("dist");
copy("server", (file) => !/\.test\.js$/.test(file) && !file.split(path.sep).includes("fixtures"));
copy("workflows");
copy("scripts/ensure-runtime-dependencies.mjs");
copy("scripts/start.mjs");
for (const file of ["package-lock.json", ".env.example", "README.md", "CHANGELOG.md", "LICENSE"]) {
  if (fs.existsSync(path.join(root, file))) copy(file);
}
copy("docs/guides/TROUBLESHOOTING.md");

// A release only ever runs `npm start`, through the supervisor that also
// installs updates. Build scripts would need the missing dev tools.
const releasePkg = {
  ...pkg,
  scripts: {
    start: "node scripts/start.mjs"
  }
};
fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify(releasePkg, null, 2)}\n`);

// The Node.js every download brings: the newest LTS with builds for all three
// systems, unless pinned.
async function bundledNodeVersion() {
  if (process.env.HEISS_NODE_VERSION) return process.env.HEISS_NODE_VERSION.replace(/^v/, "");
  const response = await fetch("https://nodejs.org/dist/index.json", { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Could not list Node.js releases (${response.status}).`);
  const needed = ["win-x64-zip", "osx-arm64-tar", "linux-x64"];
  const lts = (await response.json()).find((release) => release.lts && needed.every((file) => release.files?.includes(file)));
  if (!lts) throw new Error("No Node.js LTS release with builds for Windows, macOS and Linux.");
  return lts.version.replace(/^v/, "");
}
const nodeVersion = await bundledNodeVersion();

let commit = "";
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
// Double-click launchers, one per system (Linux also gets a desktop entry).
// This folder (the update zip) keeps all of them; each download below keeps
// only its own, and an update skips the others (see LAUNCHER_FILES in
// server/release-swap.js).
fs.writeFileSync(path.join(target, LAUNCHERS.darwin), shellLauncher(), { mode: 0o755 });
fs.writeFileSync(path.join(target, LAUNCHERS.linux), shellLauncher(), { mode: 0o755 });
fs.writeFileSync(path.join(target, DESKTOP_ENTRY), desktopEntry(), { mode: 0o755 });
fs.writeFileSync(path.join(target, LAUNCHERS.win32), windowsLauncher());

// `files` lists what an update may replace; everything else in the folder
// (data/, .env, node_modules, runtime/) belongs to the user.
const files = [...fs.readdirSync(target), "release.json"].sort();
// `node`: the Node.js a download runs; an update to a release that wants a
// newer one fetches it (see server/node-runtime.js).
fs.writeFileSync(path.join(target, "release.json"), `${JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), node: nodeVersion, files }, null, 2)}\n`);

// Windows has no zip command, but its tar (bsdtar) writes zips; CI packages there too.
// Name System32's copy: a GNU tar from Git may come first on PATH and cannot.
const windowsTar = () => path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
/**
 * Takes npm's command links (node_modules/.bin) out of a Windows download.
 * Built on Linux they are POSIX symlinks, which Windows doesn't use (its
 * shims are .cmd files), and 7-Zip (PeaZip) refuses one pointing up a folder
 * as a "dangerous link": a fatal error on unzip, though nothing is missing.
 */
function removeLinks(dir) {
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) { fs.rmSync(full); removed += 1; }
    else if (entry.isDirectory()) removed += removeLinks(full);
  }
  return removed;
}

function zipFolder(zip, cwd) {
  fs.rmSync(zip, { force: true });
  if (process.platform === "win32") execFileSync(windowsTar(), ["-a", "-c", "-f", zip, name], { cwd });
  else execFileSync("zip", ["-qry", zip, name], { cwd });
  return crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
}

// npm is npm.cmd on Windows, which Node only runs through a shell.
function runNpm(args, cwd, extraEnv = {}) {
  const cli = process.env.npm_execpath;
  const options = { cwd, stdio: "inherit", env: { ...process.env, ...extraEnv } };
  if (cli && /npm-cli\.[cm]?js$/.test(cli)) return execFileSync(process.execPath, [cli, ...args], options);
  if (process.platform === "win32") return execSync(`npm ${args.join(" ")}`, options);
  return execFileSync("npm", args, options);
}

// The update: no packages. The in-app updater downloads exactly this name and
// never touches node_modules. GitHub publishes its digest, which the updater checks.
const zip = path.join(outDir, `${name}.zip`);
const zipSha256 = zipFolder(zip, outDir);
console.log(`Packaged${signZip(zip, zipSha256)} ${path.relative(root, zip)} (sha256 ${zipSha256})`);

// The downloads: the same app with its runtime packages already installed for
// one platform (sharp's native binary differs), so a first start installs
// nothing. npm fetches another platform's binaries with --os/--cpu, so all of
// them build on one machine. node_modules is not in release.json's `files`, so
// updates leave it alone.
// Node's official archive for the platform, checked against nodejs.org's
// checksums and kept between builds in release/.cache.
async function bundledNode(dest, bundle) {
  const folder = runtimeFolder(nodeVersion, bundle.cpu, bundle.os);
  const archiveName = runtimeArchive(folder);
  const cache = path.join(outDir, ".cache");
  const archive = path.join(cache, archiveName);
  const sha256 = await publishedSha256(nodeVersion, archiveName);
  const cached = fs.existsSync(archive) && crypto.createHash("sha256").update(fs.readFileSync(archive)).digest("hex") === sha256;
  if (!cached) {
    fs.mkdirSync(cache, { recursive: true });
    await downloadVerified(`https://nodejs.org/dist/v${nodeVersion}/${archiveName}`, archive, sha256);
  }
  const runtime = path.join(dest, "runtime");
  fs.mkdirSync(runtime, { recursive: true });
  if (archiveName.endsWith(".zip")) {
    if (process.platform === "win32") execFileSync(windowsTar(), ["-xf", archive, "-C", runtime]);
    else execFileSync("unzip", ["-q", archive, "-d", runtime]);
  } else {
    // tar keeps the executable bits and npm's links; zip -y below stores both.
    execFileSync(process.platform === "win32" ? windowsTar() : "tar", ["-xzf", archive, "-C", runtime]);
    // C headers and man pages: only for building Node addons, which a release never does.
    for (const extra of ["include", "share"]) fs.rmSync(path.join(runtime, folder, extra), { recursive: true, force: true });
  }
  // No newline: the .bat reads it with `set /p`.
  fs.writeFileSync(path.join(runtime, "current.txt"), folder);
}

const bundles = [
  { id: "windows-x64", os: "win32", cpu: "x64" },
  { id: "macos-arm64", os: "darwin", cpu: "arm64" },
  { id: "linux-x64", os: "linux", cpu: "x64", libc: "glibc" }
];
for (const bundle of bundles) {
  // Windows cannot keep the executable bits and links macOS and Linux need, so
  // those downloads are only built on macOS or Linux (the Release workflow uses Linux).
  if (process.platform === "win32" && bundle.os !== "win32") {
    console.log(`Skipped ${name}-${bundle.id}.zip: package on macOS or Linux for that one.`);
    continue;
  }
  const stage = path.join(outDir, `.bundle-${bundle.id}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(target, path.join(stage, name), { recursive: true });
  for (const launcher of Object.keys(LAUNCHER_FILES)) if (foreignLauncher(launcher, bundle.os)) fs.rmSync(path.join(stage, name, launcher));
  runNpm(["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", `--os=${bundle.os}`, `--cpu=${bundle.cpu}`, ...(bundle.libc ? [`--libc=${bundle.libc}`] : [])], path.join(stage, name));
  // Download the target encoder without executing a foreign binary.
  runNpm(["rebuild", "ffmpeg-static", "--no-audit", "--no-fund"], path.join(stage, name), { npm_config_platform: bundle.os, npm_config_arch: bundle.cpu });
  if (bundle.os === "win32") removeLinks(path.join(stage, name, "node_modules"));
  await bundledNode(path.join(stage, name), bundle);
  const bundleZip = path.join(outDir, `${name}-${bundle.id}.zip`);
  fs.rmSync(`${bundleZip}.sig`, { force: true });
  zipFolder(bundleZip, stage);
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`Packaged ${path.relative(root, bundleZip)} (${(fs.statSync(bundleZip).size / 1e6).toFixed(1)} MB, packages and Node.js ${nodeVersion} included)`);
}
