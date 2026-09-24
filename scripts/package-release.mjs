// Assembles a ready-to-run HEISS UI release from an already built checkout:
// the built app (dist/), the server, bundled workflows and the lockfile, but no
// sources, tests or build tools. Users unpack it and run `npm start`, which goes
// through scripts/start.mjs: it installs the three runtime packages (about
// 30 MB) on first run, swaps in updates and restarts the server on request.
//
//   npm run build && node scripts/package-release.mjs
//
// Writes release/heiss-ui-<version>/ and release/heiss-ui-<version>.zip.
import { execFileSync } from "node:child_process";
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
// Double-click launchers. The first run installs the runtime packages.
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

const zip = path.join(outDir, `${name}.zip`);
fs.rmSync(zip, { force: true });
// Windows has no zip command, but its tar (bsdtar) writes zips; CI packages there too.
// Name System32's copy: a GNU tar from Git may come first on PATH and cannot.
if (process.platform === "win32") execFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", zip, name], { cwd: outDir });
else execFileSync("zip", ["-qry", zip, name], { cwd: outDir });
// GitHub publishes this same digest for the release asset; the in-app updater checks against it.
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
console.log(`Packaged ${path.relative(root, zip)} (sha256 ${sha256})`);
