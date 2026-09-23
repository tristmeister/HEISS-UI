// Assembles a ready-to-run HEISS UI release from an already built checkout:
// the built app (dist/), the server, bundled workflows and the lockfile, but no
// sources, tests or build tools. Users unpack it and run `npm start`; the
// prestart hook installs the three runtime packages (about 30 MB) on first run.
//
//   npm run build && node scripts/package-release.mjs
//
// Writes release/heiss-ui-<version>/ and release/heiss-ui-<version>.zip.
import { execFileSync } from "node:child_process";
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
for (const file of ["package-lock.json", ".env.example", "README.md", "CHANGELOG.md", "LICENSE"]) copy(file);

// A release only ever runs `npm start`: keep the runtime packages and the start
// hooks, drop build scripts that would need the missing dev tools.
const releasePkg = {
  ...pkg,
  scripts: {
    prestart: pkg.scripts.prestart,
    start: pkg.scripts.start
  }
};
fs.writeFileSync(path.join(target, "package.json"), `${JSON.stringify(releasePkg, null, 2)}\n`);

let commit = "";
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: root }).toString().trim(); } catch { /* not a checkout */ }
fs.writeFileSync(path.join(target, "release.json"), `${JSON.stringify({ version: pkg.version, commit, builtAt: new Date().toISOString() }, null, 2)}\n`);

// Double-click launchers. The first run installs the runtime packages.
fs.writeFileSync(path.join(target, "Start HEISS UI.command"), "#!/bin/sh\ncd \"$(dirname \"$0\")\" && npm start\n", { mode: 0o755 });
fs.writeFileSync(path.join(target, "Start HEISS UI.bat"), "@echo off\r\ncd /d \"%~dp0\"\r\nnpm start\r\npause\r\n");

const zip = path.join(outDir, `${name}.zip`);
fs.rmSync(zip, { force: true });
execFileSync("zip", ["-qry", zip, name], { cwd: outDir });
console.log(`Packaged ${path.relative(root, zip)}`);
