import assert from "node:assert/strict";
import test from "node:test";
import { cutRelease, section } from "./changelog.mjs";

const base = `# Changelog

## [Unreleased]

### Added
- A thing.

## [0.1.0]

Baseline.

[Unreleased]: https://github.com/tristmeister/HEISS-UI/commits/main
`;

test("the first release takes the Unreleased notes and links to its tag", () => {
  const next = cutRelease(base, "0.2.0", "2026-09-23");
  assert.equal(section(next, "Unreleased"), "");
  assert.equal(section(next, "0.2.0"), "### Added\n- A thing.");
  assert.match(next, /## \[0\.2\.0\] - 2026-09-23/);
  assert.match(next, /^\[Unreleased\]: .*compare\/v0\.2\.0\.\.\.HEAD$/m);
  assert.match(next, /^\[0\.2\.0\]: .*releases\/tag\/v0\.2\.0$/m);
  assert.equal(section(next, "0.1.0"), "Baseline.");
});

test("later releases compare against the previous tag", () => {
  const first = cutRelease(base, "0.2.0", "2026-09-23").replace("## [Unreleased]\n", "## [Unreleased]\n\n### Fixed\n- A bug.\n");
  const second = cutRelease(first, "0.2.1", "2026-10-01");
  assert.equal(section(second, "0.2.1"), "### Fixed\n- A bug.");
  assert.match(second, /^\[0\.2\.1\]: .*compare\/v0\.2\.0\.\.\.v0\.2\.1$/m);
  assert.match(second, /^\[0\.2\.0\]: .*releases\/tag\/v0\.2\.0$/m);
  assert.match(second, /^\[Unreleased\]: .*compare\/v0\.2\.1\.\.\.HEAD$/m);
});

test("no notes, no release", () => {
  const empty = base.replace("### Added\n- A thing.\n", "");
  assert.throws(() => cutRelease(empty, "0.2.0", "2026-09-23"), /nothing under Unreleased/);
});
