// Cuts a HEISS UI release. See CONTRIBUTING.md, "Versions and releases".
//
//   npm run release -- minor          # 0.2.0 -> 0.3.0: new features (or a breaking change before 1.0)
//   npm run release -- patch          # 0.2.0 -> 0.2.1: fixes only
//   npm run release -- 1.0.0          # an exact version; 1.0.0 is the public release
//   npm run release -- minor --dry-run
//   npm run release -- minor --push   # also push main and the tag (publishes the GitHub release)
//
// It checks that main is clean and in sync with origin, that CHANGELOG.md has
// notes under Unreleased, and that tests and the build pass. Then it bumps
// package.json and the lockfile, dates the changelog section, commits
// "Release vX.Y.Z" and makes an annotated tag with the notes. Pushing the tag
// runs .github/workflows/release.yml, which publishes the download.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { changelogPath, cutRelease, section } from "./changelog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const bump = args.find((arg) => !arg.startsWith("--"));
const dryRun = args.includes("--dry-run");
const push = args.includes("--push");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// npm is npm.cmd on Windows, which Node only runs through a shell.
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { cwd: root, encoding: "utf8", stdio: options.quiet ? "pipe" : "inherit", shell: command === npm && process.platform === "win32", ...options });
const git = (...gitArgs) => run("git", gitArgs, { quiet: true }).trim();
const fail = (message) => { console.error(`\n✗ ${message}\n`); process.exit(1); };

const current = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const [major, minor, patch] = current.split(".").map(Number);

function nextVersion() {
  if (!bump) fail("Say which release: `npm run release -- minor`, `-- patch`, or an exact version like `-- 0.3.0`.");
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "major") {
    // 1.0.0 is the public announcement; it should never happen by accident.
    if (major === 0) fail("Before 1.0, breaking changes bump the minor version. For the public release, run `npm run release -- 1.0.0`.");
    return `${major + 1}.0.0`;
  }
  if (!/^\d+\.\d+\.\d+$/.test(bump)) fail(`"${bump}" is not patch, minor, major or a version like 0.3.0.`);
  const parts = bump.split(".").map(Number);
  const newer = parts[0] - major || parts[1] - minor || parts[2] - patch;
  if (newer <= 0) fail(`${bump} is not newer than the current ${current}.`);
  return bump;
}

const version = nextVersion();
const tag = `v${version}`;
console.log(`Releasing HEISS UI ${current} -> ${version}${dryRun ? " (dry run)" : ""}`);

// Only ever release what is on origin/main, committed.
if (git("rev-parse", "--abbrev-ref", "HEAD") !== "main") fail("Releases are cut from main.");
if (git("status", "--porcelain")) fail("The working tree has uncommitted changes. Commit or stash them first.");
if (git("tag", "--list", tag)) fail(`The tag ${tag} already exists.`);
run("git", ["fetch", "--quiet", "origin", "main", "--tags"]);
if (git("rev-list", "--count", "HEAD..origin/main") !== "0") fail("origin/main has commits this checkout lacks. Pull first.");

const changelog = fs.readFileSync(changelogPath, "utf8");
const notes = section(changelog, "Unreleased");
if (!notes) fail("CHANGELOG.md has nothing under Unreleased. Write the release notes first.");
const today = new Date().toISOString().slice(0, 10);
const nextChangelog = cutRelease(changelog, version, today);

console.log("\nRunning the tests and the build…");
run(npm, ["test"], { stdio: "inherit" });
run(npm, ["run", "build"], { stdio: "inherit" });

if (dryRun) {
  console.log(`\nWould release ${tag} with these notes:\n\n${notes}\n`);
  process.exit(0);
}

run(npm, ["version", version, "--no-git-tag-version"], { quiet: true });
fs.writeFileSync(changelogPath, nextChangelog);
run("git", ["add", "package.json", "package-lock.json", "CHANGELOG.md"]);
run("git", ["commit", "--quiet", "-m", `Release ${tag}`]);
run("git", ["tag", "--annotate", tag, "--cleanup=verbatim", "-m", `HEISS UI ${tag}\n\n${notes}`]);
console.log(`\n✓ Committed "Release ${tag}" and tagged ${tag}.`);

if (push) {
  run("git", ["push", "--atomic", "origin", "main", tag]);
  console.log(`✓ Pushed. GitHub Actions now builds and publishes the ${tag} release.`);
} else {
  console.log(`\nPush when ready (this publishes the GitHub release):\n\n  git push --atomic origin main ${tag}\n`);
}
