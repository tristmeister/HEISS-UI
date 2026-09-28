import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Each test file runs in its own process, so this data folder stays here.
process.env.HEISS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-data-"));
const { setGallery } = await import("./gallery-store.js");
const history = await import("./prompt-history.js");

test("the first list starts from the gallery, never from Hidden", () => {
  setGallery([
    { id: "a", url: "a", status: "done", prompt: "a red fox", createdAt: "2026-01-01T00:00:00Z" },
    { id: "b", url: "b", status: "done", prompt: "A  red fox", createdAt: "2026-01-03T00:00:00Z" },
    { id: "c", url: "c", status: "done", prompt: "a secret", privateVault: true, createdAt: "2026-01-04T00:00:00Z" },
    { id: "d", url: "d", status: "pending", prompt: "still running", createdAt: "2026-01-05T00:00:00Z" },
    { id: "e", url: "e", status: "done", prompt: "a blue owl", createdAt: "2026-01-02T00:00:00Z" }
  ], { persist: false });
  const list = history.listPrompts();
  assert.deepEqual(list.map((entry) => entry.text), ["A  red fox", "a blue owl"]);
  assert.equal(list[0].uses, 2, "spacing and case do not make a new prompt");
  assert.ok(fs.existsSync(history.promptHistoryPath));
});

test("using a prompt again moves it to the top instead of repeating it", () => {
  history.recordPrompt("a blue owl ");
  history.recordPrompt("a green frog");
  const list = history.listPrompts();
  assert.deepEqual(list.map((entry) => entry.text), ["a green frog", "a blue owl", "A  red fox"]);
  assert.equal(list[1].uses, 2);
  history.recordPrompt("   ");
  assert.equal(history.listPrompts().length, 3, "an empty prompt is not kept");
});

test("pinned prompts outlive the cap; the rest keep the newest", () => {
  history.setPromptPinned("A red fox", true);
  let entries = history.listPrompts();
  const start = Date.now();
  for (let index = 0; index < history.historyLimit + 20; index += 1) entries = history.addPrompt(entries, `prompt ${index}`, start + index * 1000);
  assert.equal(entries.filter((entry) => !entry.pinned).length, history.historyLimit);
  assert.ok(entries.some((entry) => entry.pinned && entry.text === "A  red fox"));
  assert.equal(entries[0].text, `prompt ${history.historyLimit + 19}`);
});

test("forgetting spares prompts the gallery still shows", () => {
  history.forgetPrompts(["a green frog", "a blue owl"], new Set([history.promptKey("a blue owl")]));
  const texts = history.listPrompts().map((entry) => entry.text);
  assert.ok(!texts.includes("a green frog"));
  assert.ok(texts.includes("a blue owl"));
});

test("clearing keeps pinned prompts unless asked not to", () => {
  history.clearPromptHistory();
  assert.deepEqual(history.listPrompts().map((entry) => entry.text), ["A  red fox"]);
  history.clearPromptHistory({ keepPinned: false });
  assert.deepEqual(history.listPrompts(), []);
  history.resetPromptHistoryCache();
  assert.deepEqual(history.listPrompts(), [], "the saved file is read back, and an empty list is not re-seeded");
});
