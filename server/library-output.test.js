import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// A folder of earlier images with ComfyUI's output folder inside it.
const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "heiss-library-parent-")));
const outputDir = path.join(parent, "output");
fs.mkdirSync(outputDir);
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
test.after(() => {
  fs.rmSync(parent, { recursive: true, force: true });
  fs.rmSync(process.env.HEISS_DATA_DIR, { recursive: true, force: true });
});

const store = await import("./gallery-store.js");
const library = await import("./library.js");

test("an image the library does not serve is not shown either, as when the output folder is set inside a library folder", async () => {
  fs.writeFileSync(path.join(parent, "earlier.png"), "an earlier image");
  fs.writeFileSync(path.join(outputDir, "made.png"), "an output");
  const result = await library.addLibraryFolder(parent);
  assert.equal(result.added, 1, "the output folder inside it is not scanned");
  const folder = library.libraryFolders()[0];
  // A record from before the output folder was set there.
  const stale = { id: "/api/library/file?stale", url: "/api/library/file?stale", type: "image", status: "done", outputName: "made.png", createdAt: new Date().toISOString(), library: { folder: folder.id, path: "output/made.png" } };
  store.setGallery([stale, ...store.gallery], { persist: false });
  assert.equal(library.libraryFile(folder.id, "output/made.png"), null);
  const shown = store.filterVisibleGallery(store.gallery).map((item) => item.outputName);
  assert.deepEqual(shown, ["earlier.png"]);
});
