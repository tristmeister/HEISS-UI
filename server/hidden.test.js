import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-hidden-"));
const outputDir = path.join(temporary, "ComfyUI", "output");
fs.mkdirSync(outputDir, { recursive: true });
process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.COMFY_OUTPUT_DIR = outputDir;
// Nothing here should reach a real ComfyUI.
process.env.COMFY_URL = "http://127.0.0.1:9";

const privacy = await import("./privacy.js");
const vault = await import("./vault.js");

/** A browser request carrying whatever cookie a response set. */
function requestFrom(res) {
  const header = [].concat(res.headers["Set-Cookie"] || [])[0] || "";
  return { headers: { cookie: header.split(";")[0] } };
}
function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name] = value; } };
}

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;

test("the key ring opens with the password and with a passkey's PRF secret, nothing else", () => {
  const key = privacy.setupPrivacy("correct horse");
  assert.equal(key.length, 32);
  assert.throws(() => privacy.setupPrivacy("another one"), /already/);
  assert.deepEqual(privacy.unlockWithPassword("correct horse"), key);
  assert.equal(privacy.unlockWithPassword("wrong horse"), null);

  const prf = crypto.randomBytes(32).toString("base64url");
  privacy.addPasskey(key, { id: "cred-1", name: "Touch ID", salt: crypto.randomBytes(32).toString("base64url"), prf });
  assert.deepEqual(privacy.unlockWithPasskey("cred-1", prf), key);
  assert.equal(privacy.unlockWithPasskey("cred-1", crypto.randomBytes(32).toString("base64url")), null);
  assert.equal(privacy.unlockWithPasskey("cred-2", prf), null);
  assert.deepEqual(privacy.passkeyUnlockOptions().map((item) => item.id), ["cred-1"]);

  // A new password wraps the same key, so the passkey keeps working too.
  privacy.changePassword(key, "battery staple");
  assert.equal(privacy.unlockWithPassword("correct horse"), null);
  assert.deepEqual(privacy.unlockWithPassword("battery staple"), key);
  assert.deepEqual(privacy.unlockWithPasskey("cred-1", prf), key);
  assert.ok(privacy.removePasskey("cred-1"));
  assert.equal(privacy.unlockWithPasskey("cred-1", prf), null);
});

test("an unlock cookie carries the key and a locked request carries nothing", () => {
  const key = privacy.unlockWithPassword("battery staple");
  const res = response();
  privacy.setUnlockCookie(res, key, 120);
  assert.match(res.headers["Set-Cookie"], /HttpOnly/);
  assert.match(res.headers["Set-Cookie"], /Max-Age=120/);
  assert.deepEqual(privacy.encryptionKeyFromRequest(requestFrom(res)), key);
  assert.equal(privacy.encryptionKeyFromRequest({ headers: {} }), null);
  assert.equal(privacy.privacyStatusFor({ headers: {} }).unlocked, false);
});

test("Hidden stores a run encrypted and never hands out its keys", async () => {
  const key = privacy.unlockWithPassword("battery staple");
  const { items } = await vault.storeHiddenOutputs(key, [{ url: dataUrl, filename: "out.png", type: "image" }], { prompt: "a secret lighthouse", kind: "image", width: 1, height: 1 });
  assert.equal(items.length, 1);
  const [item] = vault.vaultItems(key, { bundles: false });
  assert.equal(item.prompt, "a secret lighthouse");
  assert.equal(item.assetKey, undefined);
  assert.equal(item.assetFile, undefined);
  assert.match(item.url, /^\/api\/vault\/media\//);
  assert.deepEqual(vault.readVaultAssetWithKey(key, item.id).buffer, png);
  assert.equal(vault.readVaultAssetWithKey(crypto.randomBytes(32), item.id), null);

  // Nothing on disk spells out the prompt.
  const dir = path.join(process.env.HEISS_DATA_DIR, ".private-vault");
  for (const file of fs.readdirSync(dir, { recursive: true })) {
    const full = path.join(dir, String(file));
    if (fs.statSync(full).isFile()) assert.ok(!fs.readFileSync(full).includes("lighthouse"), `${file} leaks the prompt`);
  }
  vault.deleteVaultItems(key, [item.id]);
  assert.equal(vault.vaultItems(key).length, 0);
});

test("hiding moves a file out of ComfyUI's folder and unhiding puts it back", async () => {
  const key = privacy.unlockWithPassword("battery staple");
  fs.writeFileSync(path.join(outputDir, "ComfyUI_00001_.png"), png);
  fs.writeFileSync(path.join(outputDir, "ComfyUI_00001_up.png"), png);
  const url = "/comfy/view?filename=ComfyUI_00001_.png&subfolder=&type=output";
  const upscaleUrl = "/comfy/view?filename=ComfyUI_00001_up.png&subfolder=&type=output";
  const galleryItem = { id: url, url, outputName: "ComfyUI_00001_.png", status: "done", type: "image", prompt: "a quiet harbour", createdAt: new Date().toISOString(), upscale: { status: "done", url: upscaleUrl, outputName: "ComfyUI_00001_up.png", scale: 2 }, upscaleActive: true };

  const hidden = await vault.hideItems(key, [galleryItem]);
  assert.equal(hidden.moved.length, 1);
  assert.equal(hidden.leftBehind, 0);
  assert.ok(!fs.existsSync(path.join(outputDir, "ComfyUI_00001_.png")));
  assert.ok(!fs.existsSync(path.join(outputDir, "ComfyUI_00001_up.png")));
  const [item] = vault.vaultItems(key, { bundles: false });
  assert.equal(item.prompt, "a quiet harbour");
  assert.match(item.upscale.url, /variant=upscale/);
  assert.deepEqual(vault.readVaultAssetWithKey(key, item.id, "upscale").buffer, png);

  const restored = vault.unhideItems(key, [item.id]);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].prompt, "a quiet harbour");
  assert.ok(fs.existsSync(path.join(outputDir, restored[0].outputName)));
  assert.ok(fs.existsSync(path.join(outputDir, restored[0].upscale.outputName)));
  assert.equal(vault.vaultItems(key).length, 0);
});

test("a version 1 install migrates on its first unlock and keeps its data readable", () => {
  vault.eraseVault();
  privacy.erasePrivacy();
  const salt = () => crypto.randomBytes(16).toString("base64url");
  const passwordSalt = salt();
  const encryptionSalt = salt();
  const legacyKey = crypto.scryptSync("old password", Buffer.from(encryptionSalt, "base64url"), 32);
  fs.writeFileSync(path.join(process.env.HEISS_DATA_DIR, "privacy.json"), JSON.stringify({
    enabled: true,
    version: 1,
    passwordSalt,
    encryptionSalt,
    sessionSecret: crypto.randomBytes(32).toString("base64url"),
    passwordHash: crypto.scryptSync("old password", Buffer.from(passwordSalt, "base64url"), 32).toString("base64url")
  }));
  assert.equal(privacy.unlockWithPassword("nope"), null);
  assert.deepEqual(privacy.unlockWithPassword("old password"), legacyKey);
  // Now version 2, same key.
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.HEISS_DATA_DIR, "privacy.json"), "utf8")).version, 2);
  assert.deepEqual(privacy.unlockWithPassword("old password"), legacyKey);
});

test("old sealed gallery prompts open once with the key", () => {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update("a lantern", "utf8"), cipher.final()]);
  const envelope = `enc:v1:${Buffer.from(JSON.stringify({ iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") })).toString("base64url")}`;
  const item = { id: "x", promptEncrypted: envelope, promptProtected: true, filename: "a lantern" };
  assert.equal(privacy.revealGalleryItemForRequest(item).prompt, "");
  assert.equal(privacy.openLegacyPrompt(item, key).prompt, "a lantern");
  assert.equal(privacy.openLegacyPrompt(item, crypto.randomBytes(32)), null);
});

test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
