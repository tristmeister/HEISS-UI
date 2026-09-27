import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A stand-in for GitHub's latest-release API that counts how often it is asked.
let hits = 0;
const feed = http.createServer((_req, res) => {
  hits += 1;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({
    tag_name: "v0.2.0",
    html_url: "https://example.test/v0.2.0",
    body: "### Fixed\n- **Windows: finishing an image no longer crashes.** Details.\n- **Another fix.** More.\n",
    assets: [{ name: "heiss-ui-0.2.0.zip", browser_download_url: "https://example.test/z.zip", size: 10, digest: `sha256:${"a".repeat(64)}` }]
  }));
});
await new Promise((resolve) => feed.listen(0, "127.0.0.1", resolve));
process.env.HEISS_RELEASE_API = `http://127.0.0.1:${feed.address().port}/`;
const { releaseHighlight, releaseStatus, saveUpdatePrefs, updatePrefs } = await import("./updater.js");
test.after(() => feed.close());

function install() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-updater-"));
  fs.writeFileSync(path.join(root, "release.json"), JSON.stringify({ version: "0.1.0" }));
  const dataDir = path.join(root, "data");
  fs.mkdirSync(dataDir);
  return { root, dataDir };
}

test("the release notes' first bold line is the headline", () => {
  assert.deepEqual(releaseHighlight("### Fixed\n- **Haptics tick.** On iPhone.\n- **LAN.** Works.\n\n### Added\n- Plain item"), { highlight: "Haptics tick", more: 2 });
  assert.deepEqual(releaseHighlight("- Plain first line"), { highlight: "Plain first line", more: 0 });
  assert.deepEqual(releaseHighlight(""), { highlight: "", more: 0 });
  assert.deepEqual(releaseHighlight("> Smoother model setup, clearer progress\n\n### Added\n- **A.** x\n- **B.** y"), { highlight: "Smoother model setup, clearer progress", more: 0 });
});

test("update prefs default to checking and remember a dismissed version", () => {
  const { dataDir } = install();
  assert.deepEqual(updatePrefs(dataDir), { autoCheck: true, dismissed: "" });
  saveUpdatePrefs(dataDir, { dismissed: "0.2.0" });
  saveUpdatePrefs(dataDir, { autoCheck: false });
  assert.deepEqual(updatePrefs(dataDir), { autoCheck: false, dismissed: "0.2.0" });
});

test("the automatic check never goes online while switched off", async () => {
  const { root, dataDir } = install();
  saveUpdatePrefs(dataDir, { autoCheck: false });
  const status = await releaseStatus(root, { auto: true, dataDir });
  assert.equal(hits, 0);
  assert.equal(status.available, false);
  assert.equal(status.prefs.autoCheck, false);
});

test("the automatic check asks once and then answers from its cache", async () => {
  const { root, dataDir } = install();
  const first = await releaseStatus(root, { auto: true, dataDir });
  const second = await releaseStatus(root, { auto: true, dataDir });
  assert.equal(hits, 1);
  assert.equal(first.available, true);
  assert.equal(first.latest, "0.2.0");
  assert.equal(first.highlight, "Windows: finishing an image no longer crashes");
  assert.equal(first.more, 1);
  assert.equal(second.latest, "0.2.0");
});
