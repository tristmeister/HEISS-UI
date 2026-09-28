import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { comfy, comfyInputDir } from "./comfy.js";
import { queuedIds } from "./comfy-queue.js";
import { dataDir, hideGalleryItems, markerOf, outputsFrom, removeGalleryJob } from "./gallery-store.js";
import { readJsonFile, writeJsonFile } from "./json-store.js";
import { adoptSealedOutputs, adoptSealedUpscale, discardLooseAssets, outputFileOf, sealAsset, sourceFromOutput } from "./vault.js";

/*
 * Hidden runs ComfyUI may still hold.
 *
 * A Hidden run is written down here before ComfyUI gets it, and struck off
 * only once what it made is sealed and ComfyUI's history entry and staged
 * inputs are gone. A run HEISS UI lost track of (ComfyUI out of reach for a
 * minute, HEISS UI restarted) is finished from this list later: what ComfyUI
 * made of it is sealed the moment it turns up, its plaintext copies go, and
 * nothing of it ever reaches the gallery.
 *
 * Nothing here says what a run was. A run is known by a keyed digest of its
 * prompt id, like the gallery's hide markers, and so are its staged inputs.
 * What finishing it needs (its prompt and settings) is sealed with Hidden's
 * master key. Its late images can still be sealed while Hidden is locked:
 * each run has a key pair of its own, the private half sealed with the master
 * key, so they are encrypted to the public half and join Hidden on the next
 * unlock.
 */

const runsPath = path.join(dataDir, "hidden-runs.json");
const noteLabel = Buffer.from("heiss-hidden-run-v1");
const parcelLabel = Buffer.from("heiss-hidden-late-output-v1");

let runs = loadRuns();
// Prompt ids a job on this server is following right now; the sweep leaves those to it.
const live = new Set();

function loadRuns() {
  try {
    const saved = readJsonFile(runsPath);
    return (Array.isArray(saved?.runs) ? saved.runs : []).filter((run) => run?.id).map((run) => ({ ...run, parcels: Array.isArray(run.parcels) ? run.parcels : [] }));
  } catch {
    return [];
  }
}

function saveRuns() {
  fs.mkdirSync(dataDir, { recursive: true });
  writeJsonFile(runsPath, { version: 1, runs });
  try { fs.chmodSync(runsPath, 0o600); } catch { /* Windows keeps its own ACLs. */ }
}

const runDigest = (promptId) => markerOf(`hidden-run:${promptId}`);
const inputDigest = (name) => markerOf(`hidden-input:${name}`);
const b64 = (buffer) => Buffer.from(buffer).toString("base64url");
const fromB64 = (text) => Buffer.from(String(text || ""), "base64url");

function aesSeal(plain, key, label) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(label);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return b64(Buffer.concat([iv, cipher.getAuthTag(), data]));
}

function aesOpen(text, key, label) {
  try {
    const raw = fromB64(text);
    if (raw.length < 28) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(label);
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
  } catch {
    return null;
  }
}

/** Encrypts `value` so only the holder of the run's private key can read it (X25519, then AES-GCM). */
function sealTo(publicKey, value) {
  const recipient = crypto.createPublicKey({ key: fromB64(publicKey), format: "der", type: "spki" });
  const ephemeral = crypto.generateKeyPairSync("x25519");
  const shared = crypto.diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const sender = ephemeral.publicKey.export({ format: "der", type: "spki" });
  const key = Buffer.from(crypto.hkdfSync("sha256", shared, sender, parcelLabel, 32));
  return `${b64(sender)}.${aesSeal(Buffer.from(JSON.stringify(value)), key, parcelLabel)}`;
}

function openWith(privateKey, text) {
  try {
    const [senderText, data] = String(text || "").split(".");
    const sender = fromB64(senderText);
    const shared = crypto.diffieHellman({ privateKey, publicKey: crypto.createPublicKey({ key: sender, format: "der", type: "spki" }) });
    const key = Buffer.from(crypto.hkdfSync("sha256", shared, sender, parcelLabel, 32));
    const plain = aesOpen(data, key, parcelLabel);
    return plain ? JSON.parse(plain.toString("utf8")) : null;
  } catch {
    return null;
  }
}

/**
 * Writes a Hidden run down before ComfyUI gets it. `key` is Hidden's master
 * key; without one (Hidden erased meanwhile) the run is still followed, but
 * whatever it makes late is removed instead of kept.
 * details: { kind: "run", body } or { kind: "upscale", itemId, state }, and
 * `inputNames`, the images staged in ComfyUI's input folder for it.
 */
export function rememberHiddenRun(key, promptId, { kind = "run", body = null, itemId = "", state = null, inputNames = [] } = {}) {
  if (!promptId) return;
  const id = runDigest(promptId);
  const pair = crypto.generateKeyPairSync("x25519");
  // A start image sent inline is already staged in ComfyUI; its bytes are not needed again.
  const { startImage: _startImage, ...kept } = body || {};
  const note = { promptId, kind, privateKey: b64(pair.privateKey.export({ format: "der", type: "pkcs8" })), ...(kind === "upscale" ? { itemId, state } : { body: kept }) };
  runs = runs.filter((run) => run.id !== id);
  runs.push({
    id,
    at: Date.now(),
    publicKey: key ? b64(pair.publicKey.export({ format: "der", type: "spki" })) : "",
    sealed: key ? aesSeal(Buffer.from(JSON.stringify(note)), key, noteLabel) : "",
    inputs: inputNames.filter(Boolean).map((name) => inputDigest(String(name))),
    parcels: [],
    missing: 0
  });
  live.add(promptId);
  saveRuns();
}

/**
 * The job following a Hidden run has stopped. `clean`: its images are sealed
 * and ComfyUI's copies are gone, so the run is struck off. Otherwise the run
 * stays on the list and is finished from here once ComfyUI lets go of it.
 * `stored`: its images are already in Hidden, so only cleaning up is left.
 */
export function releaseHiddenRun(promptId, { clean = false, stored = false } = {}) {
  if (!promptId) return;
  live.delete(promptId);
  const run = runs.find((entry) => entry.id === runDigest(promptId));
  if (!run) return;
  if (clean && !run.parcels.length) {
    runs = runs.filter((entry) => entry !== run);
    saveRuns();
    return;
  }
  if (stored) run.stored = true;
  saveRuns();
  retryMs = firstRetryMs;
  settleSoon(0);
}

/** Whether a ComfyUI history entry is one of HEISS UI's Hidden runs, and so never belongs in the gallery. */
export function isHiddenRun(promptId, entry = null) {
  if (entry?.prompt?.[3]?.heiss_hidden) return true;
  if (!runs.length || !promptId) return false;
  const id = runDigest(promptId);
  return runs.some((run) => run.id === id);
}

/** ComfyUI's history without HEISS UI's Hidden runs. */
export function withoutHiddenRuns(history) {
  if (!history || typeof history !== "object") return {};
  return Object.fromEntries(Object.entries(history).filter(([promptId, entry]) => !isHiddenRun(promptId, entry)));
}

/** How many runs are still waiting on ComfyUI or on an unlock (for tests and diagnostics). */
export function hiddenRunCount() {
  return runs.length;
}

/* ------------------------------------------------------------ Finishing */

const firstRetryMs = 5000;
let retryMs = firstRetryMs;
let retryTimer = null;
let chain = Promise.resolve();

function settleSoon(ms = retryMs) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    settleHiddenRuns().catch(() => null);
  }, ms);
  retryTimer.unref?.();
}

/**
 * Finishes every run no job follows any more, as far as ComfyUI allows right
 * now; tries again by itself while any is left. Resolves once a pass that
 * started after this call is done.
 */
export function settleHiddenRuns() {
  const pass = chain.then(sweep, sweep);
  chain = pass.catch(() => null);
  return pass;
}

function removeOutputFile(output) {
  const file = outputFileOf(output);
  if (!file) return false;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Removes the run's staged inputs, found by their digests; ComfyUI is done with them by now. */
function forgetInputs(run) {
  const dir = comfyInputDir();
  if (!run.inputs?.length || !dir) return;
  const wanted = new Set(run.inputs);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!wanted.has(inputDigest(name))) continue;
    try { fs.rmSync(path.join(dir, name), { force: true }); } catch { /* ComfyUI still holds it: left, as before */ }
  }
}

function strikeOff(run) {
  run.settled = true;
  if (!run.parcels.length) runs = runs.filter((entry) => entry !== run);
}

/**
 * One run ComfyUI has finished: its images sealed (only a run that worked;
 * a failed one's leftovers just go), then ComfyUI's copies, its history entry
 * and staged inputs removed.
 */
async function settleEntry(run, promptId, entry) {
  const outputs = outputsFrom(entry);
  if (!run.stored) {
    if (entry?.status?.status_str !== "error" && run.publicKey) {
      for (const output of outputs) {
        let source;
        try { source = await sourceFromOutput(output); } catch { continue; }
        const asset = sealAsset(source.buffer);
        run.parcels.push({ file: asset.assetFile, sealed: sealTo(run.publicKey, { assetKey: asset.assetKey, mime: source.mime, outputName: output.filename, type: output.type }) });
      }
    }
    run.stored = true;
    // The sealed copies are on disk before any plaintext goes.
    saveRuns();
  }
  // A copy that cannot be removed here (ComfyUI on another computer, a locked
  // file) is marked, so no import of the output folder brings it in.
  const left = outputs.filter((output) => !removeOutputFile(output));
  if (left.length) hideGalleryItems(left);
  const gone = await comfy("/history", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delete: [promptId] }),
    timeout: 10_000
  }).then(() => true, () => false);
  if (!gone) return;
  forgetInputs(run);
  strikeOff(run);
}

function findEntry(history, id) {
  for (const [promptId, entry] of Object.entries(history || {})) {
    if (runDigest(promptId) === id) return { promptId, entry };
  }
  return null;
}

async function sweep() {
  const following = new Set([...live].map(runDigest));
  const open = runs.filter((run) => !run.settled && !following.has(run.id));
  if (!open.length) return;
  let queued;
  let history;
  try {
    queued = new Set(queuedIds(await comfy("/queue", { timeout: 10_000 })).map(runDigest));
    history = await comfy("/history?max_items=64", { timeout: 15_000 });
  } catch {
    // ComfyUI is out of reach: ask again, less often the longer it stays away.
    retryMs = Math.min(60_000, retryMs * 2);
    settleSoon();
    return;
  }
  retryMs = firstRetryMs;
  let wholeHistory = false;
  for (const run of open) {
    if (!runs.includes(run)) continue;
    if (queued.has(run.id)) {
      run.missing = 0;
      continue;
    }
    let found = findEntry(history, run.id);
    if (!found && !wholeHistory) {
      // Not among the newest: look through everything ComfyUI still keeps, once per pass.
      try { history = await comfy("/history", { timeout: 60_000 }); } catch { break; }
      wholeHistory = true;
      found = findEntry(history, run.id);
    }
    if (found) {
      await settleEntry(run, found.promptId, found.entry);
      continue;
    }
    // Neither queued nor in the history: ComfyUI restarted, or never took it.
    // Its queue listing is read without a lock, so only a second miss counts.
    run.missing = (run.missing || 0) + 1;
    if (run.missing >= 2) {
      forgetInputs(run);
      strikeOff(run);
    }
  }
  saveRuns();
  if (runs.some((run) => !run.settled && !following.has(run.id))) settleSoon(10_000);
}

/* ------------------------------------------------------------ Unlocking */

/**
 * Moves what late runs made into Hidden, with their prompts and settings.
 * Called whenever a request carries the key (an unlocked Hidden). Returns how
 * many files joined.
 */
export function adoptHiddenRuns(key) {
  if (!key || !runs.some((run) => run.parcels.length)) return 0;
  let adopted = 0;
  for (const run of [...runs]) {
    if (!run.parcels.length) continue;
    const parcels = run.parcels;
    const plain = aesOpen(run.sealed, key, noteLabel);
    const note = plain ? JSON.parse(plain.toString("utf8")) : null;
    if (!note) {
      // Sealed for a Hidden that was erased since: nothing can open these any more.
      discardLooseAssets(parcels.map((parcel) => parcel.file));
    } else {
      const privateKey = crypto.createPrivateKey({ key: fromB64(note.privateKey), format: "der", type: "pkcs8" });
      const assets = [];
      for (const parcel of parcels) {
        const meta = openWith(privateKey, parcel.sealed);
        if (meta) assets.push({ ...meta, assetFile: parcel.file });
        else discardLooseAssets([parcel.file]);
      }
      try {
        if (note.kind === "upscale") {
          if (assets[0]) adoptSealedUpscale(key, note.itemId, assets[0], note.state || {});
          discardLooseAssets(assets.slice(1).map((asset) => asset.assetFile));
        } else {
          adoptSealedOutputs(key, assets, note.body || {});
          // The tile that said the run failed is answered by its images now.
          if (note.body?.clientJobId) removeGalleryJob(note.body.clientJobId, { persist: false });
        }
        adopted += assets.length;
      } catch {
        // Hidden could not be written just now; the next unlocked request tries again.
        continue;
      }
    }
    run.parcels = [];
    if (run.settled) runs = runs.filter((entry) => entry !== run);
  }
  saveRuns();
  return adopted;
}

/** Hidden was erased: runs still out there can only be cleaned up now, never kept. */
export function forgetHiddenRunKeys() {
  if (!runs.length) return;
  for (const run of runs) {
    run.publicKey = "";
    run.sealed = "";
    run.parcels = [];
  }
  runs = runs.filter((run) => !run.settled);
  saveRuns();
}
