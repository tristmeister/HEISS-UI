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
//   heiss-ui-<version>-<platform>.zip    the downloads, runtime packages included
import { execFileSync, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const name = `heiss-ui-${pkg.version}`;
const outDir = path.join(root, "release");
const target = path.join(outDir, name);

if (!fs.existsSync(path.join(root, "dist", "index.html"))) {
  console.error("dist/ is missing. Run `npm run build` first.");
  process.exit(1);
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
copy("server", (file) => !/\.test\.js$/.test(file));
copy("workflows");
copy("scripts/ensure-runtime-dependencies.mjs");
copy("scripts/start.mjs");
for (const file of ["package-lock.json", ".env.example", "README.md", "CHANGELOG.md", "LICENSE"]) copy(file);

// A release only ever runs `npm start`, through the supervisor that also
// installs updates. Build scripts would need the missing dev tools.
const releasePkg = {
  ...pkg,
  scripts: {
    start: "node scripts/start.mjs"
  }
};
fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify(releasePkg, null, 2)}\n`);

let commit = "";
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
// Double-click launchers.
fs.writeFileSync(path.join(target, "Start HEISS UI.command"), "#!/bin/sh\ncd \"$(dirname \"$0\")\" && npm start\n", { mode: 0o755 });
// The .bat skips npm: npm.cmd run without `call` never returns, so a `pause`
// after it never ran and the window closed on any error. The last line is one
// line on purpose: an update replaces this file while it runs, and cmd reads
// the next line from the new file at the old offset.
fs.writeFileSync(path.join(target, "Start HEISS UI.bat"), [
  "@echo off",
  "cd /d \"%~dp0\"",
  "if not exist \"scripts\\start.mjs\" (echo Unpack the whole zip first, then start this file from the unpacked folder.& pause & exit /b 1)",
  "where node >nul 2>nul || (echo HEISS UI needs Node.js 22 LTS or newer: https://nodejs.org & pause & exit /b 1)",
  "(node scripts\\start.mjs || pause) & exit /b",
  ""
].join("\r\n"));

// `files` lists what an update may replace; everything else in the folder
// (data/, .env, node_modules) belongs to the user.
const files = [...fs.readdirSync(target), "release.json"].sort();
fs.writeFileSync(path.join(target, "release.json"), `${JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), files }, null, 2)}\n`);

// Windows has no zip command, but its tar (bsdtar) writes zips; CI packages there too.
// Name System32's copy: a GNU tar from Git may come first on PATH and cannot.
function zipFolder(zip, cwd) {
  fs.rmSync(zip, { force: true });
  if (process.platform === "win32") execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, name], { cwd });
  else execFileSync("zip", ["-qry", zip, name], { cwd });
  return crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
}

// npm is npm.cmd on Windows, which Node only runs through a shell.
function runNpm(args, cwd) {
  const cli = process.env.npm_execpath;
  const options = { cwd, stdio: "inherit" };
  if (cli && /npm-cli\.[cm]?js$/.test(cli)) return execFileSync(process.execPath, [cli, ...args], options);
  if (process.platform === "win32") return execSync(`npm ${args.join(" ")}`, options);
  return execFileSync("npm", args, options);
}

// The update: no packages. The in-app updater downloads exactly this name and
// never touches node_modules. GitHub publishes its digest, which the updater checks.
const zip = path.join(outDir, `${name}.zip`);
console.log(`Packaged ${path.relative(root, zip)} (sha256 ${zipFolder(zip, outDir)})`);

// The downloads: the same app with its runtime packages already installed for
// one platform (sharp's native binary differs), so a first start installs
// nothing. npm fetches another platform's binaries with --os/--cpu, so all of
// them build on one machine. node_modules is not in release.json's `files`, so
// updates leave it alone.
const bundles = [
  { id: "windows-x64", os: "win32", cpu: "x64" },
  { id: "macos-arm64", os: "darwin", cpu: "arm64" },
  { id: "linux-x64", os: "linux", cpu: "x64", libc: "glibc" }
];
for (const bundle of bundles) {
  const stage = path.join(outDir, `.bundle-${bundle.id}`);
  fs.rmSync(stage, { recursive: true, force: true });
  fs.cpSync(target, path.join(stage, name), { recursive: true });
  runNpm(["ci", "--omit=dev", "--no-audit", "--no-fund", "--ignore-scripts", `--os=${bundle.os}`, `--cpu=${bundle.cpu}`, ...(bundle.libc ? [`--libc=${bundle.libc}`] : [])], path.join(stage, name));
  const bundleZip = path.join(outDir, `${name}-${bundle.id}.zip`);
  zipFolder(bundleZip, stage);
  fs.rmSync(stage, { recursive: true, force: true });
  console.log(`Packaged ${path.relative(root, bundleZip)} (${(fs.statSync(bundleZip).size / 1e6).toFixed(1)} MB, packages included)`);
}
