import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";

// Each test file runs in its own process, so these folders stay here.
const outputDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "heiss-output-")));
const dataDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-")));
const earlier = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "heiss-earlier-")));
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.HEISS_DATA_DIR = dataDir;
const store = await import("./gallery-store.js");
const library = await import("./library.js");
const { withPngText } = await import("./png-text.js");

const image = (color = "#345") => sharp({ create: { width: 12, height: 8, channels: 3, background: color } }).png().toBuffer();

test("a folder of earlier images joins the gallery in place, with its prompts", async () => {
  fs.mkdirSync(path.join(earlier, "2024", ".cache"), { recursive: true });
  fs.writeFileSync(path.join(earlier, "2024", "castle.png"), withPngText(await image(), "parameters", "a castle on a hill\nNegative prompt: fog\nSteps: 20, Sampler: Euler a, Model: dreamshaper"));
  fs.writeFileSync(path.join(earlier, "comfy.png"), withPngText(await image("#999"), "prompt", JSON.stringify({ 6: { class_type: "CLIPTextEncode", inputs: { text: "an owl in snow" } } })));
  fs.writeFileSync(path.join(earlier, "notes.txt"), "not an image");
  fs.writeFileSync(path.join(earlier, "2024", ".cache", "thumb.png"), await image());
  // An output folder HEISS UI does not know as one (yet): its own heiss-ui folder may hold what Hidden could not remove.
  fs.mkdirSync(path.join(earlier, "output", "heiss-ui"), { recursive: true });
  fs.writeFileSync(path.join(earlier, "output", "heiss-ui", "image_00001_.png"), await image("#111"));

  const result = await library.addLibraryFolder(earlier);
  assert.equal(result.added, 2);
  const items = store.gallery.filter((item) => item.library);
  const castle = items.find((item) => item.outputName === "castle.png");
  assert.equal(castle.prompt, "a castle on a hill");
  assert.equal(castle.negative, "fog");
  assert.equal(castle.model, "dreamshaper");
  assert.equal(castle.width, 12);
  assert.match(castle.url, /^\/api\/library\/file\?/);
  assert.equal(items.find((item) => item.outputName === "comfy.png").prompt, "an owl in snow");
  assert.equal(library.libraryFile(castle.library.folder, castle.library.path), path.join(earlier, "2024", "castle.png"));
  assert.ok(store.pageGallery({}).items.some((item) => item.id === castle.id), "shown while the file is there");

  // Adding it again only adds what is new.
  assert.equal((await library.addLibraryFolder(earlier)).added, 0);
});

test("only media inside the folder is served, never a dot folder or HEISS UI's own files", async () => {
  const [folder] = library.libraryFolders();
  assert.equal(library.libraryFile(folder.id, "../outside.png"), null);
  assert.equal(library.libraryFile(folder.id, "notes.txt"), null);
  assert.equal(library.libraryFile(folder.id, "2024/.cache/thumb.png"), null);
  assert.equal(library.libraryFile("nope", "comfy.png"), null);
  assert.ok(fs.existsSync(path.join(earlier, "output", "heiss-ui", "image_00001_.png")));
  assert.equal(library.libraryFile(folder.id, "output/heiss-ui/image_00001_.png"), null);
  assert.ok(!store.gallery.some((item) => item.outputName === "image_00001_.png"), "never scanned in either");
  await assert.rejects(library.addLibraryFolder(dataDir), /own folder/);
});

test("removing one from the gallery leaves its file alone and keeps it out of later scans", async () => {
  const item = store.gallery.find((entry) => entry.outputName === "comfy.png");
  assert.deepEqual(store.deleteGalleryFiles([item]), { deleted: 0, skipped: 0 });
  store.hideGalleryItems([item]);
  store.setGallery(store.gallery.filter((entry) => entry !== item), { persist: false });
  assert.ok(fs.existsSync(path.join(earlier, "comfy.png")));
  const [folder] = library.libraryFolders();
  assert.equal((await library.scanLibraryFolder(folder.id)).added, 0);
});

test("the output folder adds unknown images as ordinary outputs, never heiss-ui's own folder", async () => {
  fs.mkdirSync(path.join(outputDir, "heiss-ui"), { recursive: true });
  fs.writeFileSync(path.join(outputDir, "ComfyUI_00007_.png"), await image());
  fs.writeFileSync(path.join(outputDir, "heiss-ui", "image_00003_.png"), await image());
  const result = await library.addLibraryFolder(outputDir);
  assert.equal(result.output, true);
  assert.equal(result.added, 1);
  const added = store.gallery.find((item) => item.outputName === "ComfyUI_00007_.png");
  assert.equal(added.library, undefined);
  assert.equal(added.url, `/comfy/view?${new URLSearchParams({ filename: "ComfyUI_00007_.png", subfolder: "", type: "output" })}`);
  assert.ok(!store.gallery.some((item) => item.outputName === "image_00003_.png"));
});

test("removing the folder takes its images out of the gallery only", () => {
  const [folder] = library.libraryFolders();
  library.removeLibraryFolder(folder.id);
  assert.ok(!store.gallery.some((item) => item.library));
  assert.ok(fs.existsSync(path.join(earlier, "2024", "castle.png")));
});

test("search looks through prompts, models and LoRAs; favourites filter by star", () => {
  const done = (id, extra) => ({ id, url: id, status: "done", type: "image", createdAt: new Date().toISOString(), ...extra });
  store.setGallery([
    done("s1", { prompt: "a red fox in snow", model: "flux1-dev.safetensors" }),
    done("s2", { prompt: "a blue owl", model: "sdxl_base.safetensors", settings: { loras: [{ name: "Film Grain.safetensors" }] } }),
    { id: "s3", url: "", status: "pending", type: "image", prompt: "running now", createdAt: new Date().toISOString() }
  ], { persist: false });
  const ids = (filter) => store.pageGallery({ filter }).items.map((item) => item.id).sort();
  assert.deepEqual(ids(store.galleryFilter({ q: "FOX snow" })), ["s1", "s3"], "every word, any case; a running job stays");
  assert.deepEqual(ids(store.galleryFilter({ q: "sdxl" })), ["s2", "s3"]);
  assert.deepEqual(ids(store.galleryFilter({ q: "grain" })), ["s2", "s3"]);
  assert.equal(store.galleryFilter({ q: "  " }), null);

  const since = store.galleryRevisionValue();
  store.setGalleryFavorites(["s2"], true);
  assert.deepEqual(ids(store.galleryFilter({ favorites: true })), ["s2", "s3"]);
  store.setGalleryFavorites(["s2"], false);
  const delta = store.galleryDelta({ since, filter: store.galleryFilter({ favorites: true }) });
  assert.deepEqual(delta.upserts, []);
  assert.ok(delta.removes.includes("s2"), "an unstarred image leaves the favourites");
});
