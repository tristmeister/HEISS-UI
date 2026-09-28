import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Settings writes the token into .env; this test gives it a .env of its own.
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-env-"));
const envFile = path.join(folder, ".env");
const saved = "hf_savedsavedsavedsaved1234";
const older = "hf_olderolderolderolder5678";
fs.writeFileSync(envFile, `COMFY_URL=http://127.0.0.1:8188\nHF_TOKEN=${saved}\nHUGGING_FACE_HUB_TOKEN=${older}\n`);
process.env.HEISS_ENV_FILE = envFile;
delete process.env.HF_TOKEN;
delete process.env.HUGGING_FACE_HUB_TOKEN;
const { hfTokenStatus, saveHfToken } = await import("./hf-access.js");
test.after(() => fs.rmSync(folder, { recursive: true, force: true }));

test("removing the token clears it from .env under either name, so none comes back at the next start", () => {
  assert.deepEqual(hfTokenStatus(), { set: true, source: "settings", editable: true, key: "HF_TOKEN", hint: "hf_…1234" });
  const status = saveHfToken("");
  assert.equal(status.set, false);
  const env = fs.readFileSync(envFile, "utf8");
  assert.equal(env.includes("HF_TOKEN"), false);
  assert.equal(env.includes("HUGGING_FACE_HUB_TOKEN"), false);
  assert.match(env, /^COMFY_URL=http:\/\/127\.0\.0\.1:8188$/m, "other settings stay");
  assert.equal(process.env.HF_TOKEN, undefined);
  assert.equal(process.env.HUGGING_FACE_HUB_TOKEN, undefined);
});

test("a token set in the shell stays, and the status says it still applies", () => {
  saveHfToken("hf_newnewnewnewnewnew9999");
  process.env.HUGGING_FACE_HUB_TOKEN = "hf_shellshellshellshell4321";
  try {
    const status = saveHfToken("");
    assert.deepEqual(status, { set: true, source: "environment", editable: false, key: "HUGGING_FACE_HUB_TOKEN", hint: "hf_…4321" });
    assert.equal(process.env.HUGGING_FACE_HUB_TOKEN, "hf_shellshellshellshell4321");
    assert.equal(fs.readFileSync(envFile, "utf8").includes("HF_TOKEN"), false);
    assert.throws(() => saveHfToken("hf_anotheranotheranother00"), /HUGGING_FACE_HUB_TOKEN in the environment/);
  } finally {
    delete process.env.HUGGING_FACE_HUB_TOKEN;
  }
});
