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
fs.writeFileSync(path.join(target, "Start HEISS UI.bat"), "@echo off\r\ncd /d \"%~dp0\"\r\nnpm start\r\npause\r\n");

// `files` lists what an update may replace; everything else in the folder
// (data/, .env, node_modules) belongs to the user.
const files = [...fs.readdirSync(target), "release.json"].sort();
fs.writeFileSync(path.join(target, "release.json"), `${JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString(), files }, null, 2)}\n`);

const zip = path.join(outDir, `${name}.zip`);
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qry", zip, name], { cwd: outDir });
// Published next to the zip; the in-app updater refuses a download that does not match it.
const sha256 = crypto.createHash("sha256").update(fs.readFileSync(zip)).digest("hex");
fs.writeFileSync(`${zip}.sha256`, `${sha256}  ${name}.zip\n`);
console.log(`Packaged ${path.relative(root, zip)} (sha256 ${sha256})`);
