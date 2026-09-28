import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startFakeComfy } from "./fixtures/fake-comfy.js";

// Hidden runs against a stand-in ComfyUI: one that finishes normally, and one
// that ComfyUI finishes only after HEISS UI gave up on it (and restarted).
const fake = await startFakeComfy();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-hidden-runs-"));
const dataDir = path.join(temporary, "data");
const outputDir = path.join(temporary, "output");
const inputDir = path.join(temporary, "input");
fs.mkdirSync(path.join(outputDir, "heiss-ui"), { recursive: true });
fs.mkdirSync(inputDir, { recursive: true });
process.env.COMFY_URL = fake.url;
process.env.HEISS_DATA_DIR = dataDir;
process.env.COMFY_OUTPUT_DIR = outputDir;
process.env.COMFY_INPUT_DIR = inputDir;
// Gives up on a silent ComfyUI after a moment instead of a minute.
process.env.HEISS_COMFY_LOST_AFTER_MS = "300";

const { jobs, runJob } = await import("./jobs.js");
const store = await import("./gallery-store.js");
const privacy = await import("./privacy.js");
const vault = await import("./vault.js");
const hiddenRuns = await import("./hidden-runs.js");
test.after(async () => {
  await fake.close();
  fs.rmSync(temporary, { recursive: true, force: true });
});

const key = await privacy.setupPrivacy("correct horse battery");
const runsFile = path.join(dataDir, "hidden-runs.json");
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function hiddenRequest(id, overrides = {}) {
  return {
    kind: "image", family: "sdxl", variant: "standard", source: "checkpoint", workflow: "family:sdxl",
    profileId: "image:checkpoint:sd_xl_base_1.0.safetensors", model: "sd_xl_base_1.0.safetensors",
    bundled: { encoder: true, vae: true }, encoders: [], vae: "",
    negative: "", width: 1024, height: 1024, count: 1,
    steps: 4, cfg: 7, sampler: "euler", scheduler: "normal", seed: "1234", weightDtype: "default",
    privateVault: true, clientJobId: id, createdAt: new Date().toISOString(), startedAt: Date.now(),
    ...overrides
  };
}

function queue(id, body) {
  const items = store.makePendingItems(id, body);
  store.setGallery([...items, ...store.gallery], { persist: false });
  jobs.set(id, { status: "queued", kind: body.kind, prompt: body.prompt, outputs: [], items, startedAt: Date.now(), privateVault: true, vaultKey: key });
}

function stage(name) {
  fs.writeFileSync(path.join(inputDir, name), "reference");
  return name;
}

function saveNode(prompt) {
  return Object.entries(prompt.prompt).find(([, node]) => node.class_type === "SaveImage")[0];
}

function finishWith(prompt, filename, bytes) {
  fs.writeFileSync(path.join(outputDir, "heiss-ui", filename), bytes);
  fake.finish(prompt.id, { outputs: { [saveNode(prompt)]: { images: [{ filename, subfolder: "heiss-ui", type: "output" }] } } });
}

const history = () => fetch(`${fake.url}/history`).then((response) => response.json());

test("a Hidden run is written down before ComfyUI gets it, and struck off once it is sealed and cleaned up", async () => {
  const id = "hidden-normal";
  const staged = stage(`heiss-ui-${crypto.randomUUID()}.png`);
  const body = hiddenRequest(id, { prompt: "a lantern only I should see", stagedInputNames: [staged] });
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  assert.match(prompt.id, uuid, "HEISS UI chose the run's id, so it was written down first");
  assert.equal(prompt.prompt_id, prompt.id);
  assert.equal(prompt.extra_data.heiss_hidden, true, "the run carries its own mark into ComfyUI's history");
  assert.equal(hiddenRuns.hiddenRunCount(), 1);
  const listed = fs.readFileSync(runsFile, "utf8");
  assert.equal(listed.includes("a lantern"), false, "the list never says what the run was");
  assert.equal(listed.includes(prompt.id), false);
  assert.equal(listed.includes(staged), false);

  finishWith(prompt, "image_00001_.png", Buffer.from("lantern pixels"));
  await running;
  assert.equal(jobs.get(id).status, "done");
  assert.equal(hiddenRuns.hiddenRunCount(), 0);
  assert.ok(fake.deleted.includes(prompt.id));
  assert.equal(fs.existsSync(path.join(outputDir, "heiss-ui", "image_00001_.png")), false);
  assert.equal(fs.existsSync(path.join(inputDir, staged)), false);
  assert.ok(vault.vaultItems(key).some((item) => item.prompt === "a lantern only I should see"));
});

test("ComfyUI's history without HEISS UI's Hidden runs: marked ones, and ones on the list", () => {
  const promptId = crypto.randomUUID();
  hiddenRuns.rememberHiddenRun(key, promptId, { body: hiddenRequest("listed", { prompt: "listed" }) });
  const filtered = hiddenRuns.withoutHiddenRuns({
    [promptId]: { prompt: [0, promptId, {}, {}, []], outputs: {} },
    marked: { prompt: [0, "marked", {}, { heiss_hidden: true }, []], outputs: {} },
    ordinary: { prompt: [0, "ordinary", {}, { client_id: "x" }, []], outputs: {} }
  });
  assert.deepEqual(Object.keys(filtered), ["ordinary"]);
  assert.deepEqual(hiddenRuns.withoutHiddenRuns(null), {});
  hiddenRuns.releaseHiddenRun(promptId, { clean: true });
  assert.equal(hiddenRuns.hiddenRunCount(), 0);
});

test("a run ComfyUI no longer knows (a restart) is struck off after a second look, and its staged inputs go", async () => {
  const promptId = crypto.randomUUID();
  const staged = stage(`heiss-ui-${crypto.randomUUID()}.png`);
  hiddenRuns.rememberHiddenRun(key, promptId, { body: hiddenRequest("gone", { prompt: "gone" }), inputNames: [staged] });
  hiddenRuns.releaseHiddenRun(promptId);
  await hiddenRuns.settleHiddenRuns();
  await hiddenRuns.settleHiddenRuns();
  assert.equal(hiddenRuns.hiddenRunCount(), 0);
  assert.equal(fs.existsSync(path.join(inputDir, staged)), false);
});

test("a late run whose key is gone (Hidden erased meanwhile) only has its leftovers removed", async () => {
  const body = hiddenRequest("erased", { prompt: "erased" });
  jobs.set("erased", { status: "queued", privateVault: true, vaultKey: null });
  const queued = fake.nextPrompt();
  // The prompt goes to ComfyUI, then the run is left to the list: ComfyUI finishes it afterwards.
  fake.setDown(false);
  const running = runJob("erased", body);
  const prompt = await queued;
  fake.setDown(true);
  await running;
  finishWith(prompt, "image_00002_.png", Buffer.from("erased pixels"));
  fake.setDown(false);
  await hiddenRuns.settleHiddenRuns();
  await hiddenRuns.settleHiddenRuns();
  assert.equal(fs.existsSync(path.join(outputDir, "heiss-ui", "image_00002_.png")), false);
  assert.ok(fake.deleted.includes(prompt.id));
  assert.equal(hiddenRuns.hiddenRunCount(), 0, "nothing is kept that nothing could open");
});

test("a Hidden upscale that finishes late joins its item as the upscale", async () => {
  const body = hiddenRequest("upscaled", { prompt: "a quiet harbour" });
  const { items: [original] } = await vault.storeHiddenOutputs(key, [{ url: `data:image/png;base64,${Buffer.from("small").toString("base64")}`, filename: "harbour.png", type: "image" }], body);
  const promptId = crypto.randomUUID();
  hiddenRuns.rememberHiddenRun(key, promptId, { kind: "upscale", itemId: original.id, state: { quality: "balanced", scale: 2, width: 2048, height: 2048 } });
  hiddenRuns.releaseHiddenRun(promptId);
  fs.writeFileSync(path.join(outputDir, "heiss-ui", "upscale_00001_.png"), "large");
  fake.finish(promptId, { outputs: { 9: { images: [{ filename: "upscale_00001_.png", subfolder: "heiss-ui", type: "output" }] } } });
  await hiddenRuns.settleHiddenRuns();
  assert.equal(fs.existsSync(path.join(outputDir, "heiss-ui", "upscale_00001_.png")), false);
  assert.equal(hiddenRuns.adoptHiddenRuns(key), 1);
  const item = vault.vaultItems(key).find((entry) => entry.id === original.id);
  assert.equal(item.upscale.status, "done");
  assert.equal(item.upscale.scale, 2);
  assert.equal(item.upscaleActive, true);
  assert.equal(vault.readVaultAssetWithKey(key, original.id, "upscale").buffer.toString(), "large");
  assert.equal(hiddenRuns.hiddenRunCount(), 0);
});

// Last: its own copy of the list stands in for a restarted HEISS UI.
test("a Hidden run that loses ComfyUI is sealed when ComfyUI finishes it late, even after a restart, and never reaches the gallery", async () => {
  const id = "hidden-lost";
  const staged = stage(`heiss-ui-${crypto.randomUUID()}.png`);
  const secret = "a secret lighthouse at night";
  const body = hiddenRequest(id, { prompt: secret, stagedInputNames: [staged] });
  queue(id, body);
  const queued = fake.nextPrompt();
  const running = runJob(id, body);
  const prompt = await queued;
  // ComfyUI stops answering for longer than HEISS UI waits.
  fake.setDown(true);
  await running;
  assert.equal(jobs.get(id).status, "error");
  assert.match(jobs.get(id).error, /stopped answering/);
  // The job's own cleanup could not reach ComfyUI either; let its retries fail too.
  await hiddenRuns.settleHiddenRuns();
  await hiddenRuns.settleHiddenRuns();
  assert.equal(fake.deleted.includes(prompt.id), false);
  assert.equal(fs.readFileSync(runsFile, "utf8").includes(secret), false);

  // HEISS UI restarts; ComfyUI finishes the run and comes back.
  const restarted = await import("./hidden-runs.js?restart");
  assert.equal(restarted.hiddenRunCount(), 1, "the run survived the restart");
  const pixels = Buffer.from("lighthouse pixels");
  finishWith(prompt, "image_00003_.png", pixels);
  fake.setDown(false);

  // Any recovery from ComfyUI's history leaves it out; without that it would have been a gallery image.
  const late = await history();
  assert.equal(store.recordsFromComfyHistory(late).filter((record) => record.prompt === secret).length, 1, "the leak this guards against");
  assert.equal(store.recordsFromComfyHistory(restarted.withoutHiddenRuns(late)).filter((record) => record.prompt === secret).length, 0);

  // Sealed while Hidden is locked: no plaintext copy, no history entry, no staged input left.
  await restarted.settleHiddenRuns();
  assert.equal(fs.existsSync(path.join(outputDir, "heiss-ui", "image_00003_.png")), false);
  assert.ok(fake.deleted.includes(prompt.id));
  assert.equal(fs.existsSync(path.join(inputDir, staged)), false);
  assert.equal(fs.readFileSync(runsFile, "utf8").includes(secret), false);
  assert.equal(store.gallery.some((item) => item.prompt === secret && !item.privateVault), false);

  // The next unlocked request brings it into Hidden, prompt and all.
  assert.equal(restarted.adoptHiddenRuns(key), 1);
  const item = vault.vaultItems(key).find((entry) => entry.prompt === secret);
  assert.ok(item, "the late image is in Hidden");
  assert.equal(item.outputName, "image_00003_.png");
  assert.equal(item.settings.steps, 4);
  assert.deepEqual(vault.readVaultAssetWithKey(key, item.id).buffer, pixels);
  assert.equal(restarted.hiddenRunCount(), 0);
  assert.equal(store.gallery.some((entry) => entry.jobId === id), false, "the failed tile made way for the image");
});
