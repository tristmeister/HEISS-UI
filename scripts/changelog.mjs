// Reads and rewrites CHANGELOG.md for releases. Shared by scripts/release.mjs
// (cutting a version) and the Release workflow (printing its notes):
//
//   node scripts/changelog.mjs notes v0.2.0   # prints that version's section
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const changelogPath = path.join(root, "CHANGELOG.md");
const repoUrl = "https://github.com/tristmeister/HEISS-UI";

const heading = /^## \[([^\]]+)\][^\n]*$/gm;

/** The text under one `## [name]` heading, up to the next heading or the link list. */
export function section(text, name) {
  const matches = [...text.matchAll(heading)];
  const index = matches.findIndex((match) => match[1] === name);
  if (index < 0) return null;
  const start = matches[index].index + matches[index][0].length;
  const next = matches[index + 1]?.index ?? text.search(/^\[[^\]]+\]: /m);
  return text.slice(start, next < 0 ? undefined : next).trim();
}

/**
 * Turns Unreleased into `## [version] - date`, opens a fresh Unreleased above
 * it and keeps the compare links at the bottom current.
 */
export function cutRelease(text, version, date) {
  const notes = section(text, "Unreleased");
  if (!notes) throw new Error("CHANGELOG.md has nothing under Unreleased. Write the release notes first.");
  if (section(text, version) !== null) throw new Error(`CHANGELOG.md already has a ${version} section.`);
  // The newest version that was actually tagged (it has a link); 0.1.0 never was.
  const previous = [...text.matchAll(heading)].map((match) => match[1])
    .find((name) => /^\d+\.\d+\.\d+$/.test(name) && text.includes(`\n[${name}]: `));
  let next = text.replace(/^## \[Unreleased\][^\n]*$/m, `## [Unreleased]\n\n## [${version}] - ${date}`);
  const links = [
    `[Unreleased]: ${repoUrl}/compare/v${version}...HEAD`,
    `[${version}]: ${previous ? `${repoUrl}/compare/v${previous}...v${version}` : `${repoUrl}/releases/tag/v${version}`}`
  ];
  next = next.replace(/^\[Unreleased\]: .*$/m, links.join("\n"));
  if (!next.includes(links[0])) next = `${next.trimEnd()}\n\n${links.join("\n")}\n`;
  return next;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, tag] = process.argv.slice(2);
  if (command !== "notes" || !tag) {
    console.error("Usage: node scripts/changelog.mjs notes <vX.Y.Z>");
    process.exit(1);
  }
  const notes = section(fs.readFileSync(changelogPath, "utf8"), tag.replace(/^v/, ""));
  if (!notes) {
    console.error(`CHANGELOG.md has no section for ${tag}.`);
    process.exit(1);
  }
  process.stdout.write(`${notes}\n`);
}
