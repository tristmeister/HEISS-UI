import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// ComfyUI on another computer: its output folder is not one HEISS UI can see,
// so an image taken out of Hidden has to reach it through ComfyUI itself.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heiss-unhide-"));
const comfyOutput = path.join(temporary, "elsewhere", "output");
const uploads = [];
const comfyServer = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/upload/image") { res.writeHead(404).end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const form = await new Request("http://comfy.local", { method: "POST", headers: req.headers, body: Buffer.concat(chunks) }).formData();
  const image = form.get("image");
  const subfolder = String(form.get("subfolder") || "");
  uploads.push({ type: form.get("type"), subfolder, name: image.name });
  fs.mkdirSync(path.join(comfyOutput, subfolder), { recursive: true });
  // ComfyUI keeps an existing file and numbers the new one.
  let name = image.name;
  for (let i = 1; fs.existsSync(path.join(comfyOutput, subfolder, name)); i++) name = image.name.replace(/(\.[^.]+)$/, ` (${i})$1`);
  fs.writeFileSync(path.join(comfyOutput, subfolder, name), Buffer.from(await image.arrayBuffer()));
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name, subfolder, type: form.get("type") }));
});
await new Promise((resolve) => comfyServer.listen(0, "127.0.0.1", resolve));
test.after(() => comfyServer.close());

process.env.HEISS_DATA_DIR = path.join(temporary, "data");
process.env.COMFY_URL = `http://127.0.0.1:${comfyServer.address().port}`;
delete process.env.COMFY_OUTPUT_DIR;

const privacy = await import("./privacy.js");
const vault = await import("./vault.js");

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("unhiding hands the image to ComfyUI, into heiss-ui in its own output folder", async () => {
  const key = privacy.setupPrivacy("battery staple");
  await vault.storeHiddenOutputs(key, [{ url: `data:image/png;base64,${png.toString("base64")}`, filename: "HEISS_00007_.png", type: "image" }], { prompt: "a far pier", kind: "image", width: 1, height: 1 });
  // A file of that name is already there, from a run made while it was hidden.
  fs.mkdirSync(path.join(comfyOutput, "heiss-ui"), { recursive: true });
  fs.writeFileSync(path.join(comfyOutput, "heiss-ui", "HEISS_00007_.png"), "another image");

  const [item] = vault.vaultItems(key, { bundles: false });
  const [restored] = await vault.unhideItems(key, [item.id]);
  assert.deepEqual(uploads, [{ type: "output", subfolder: "heiss-ui", name: "HEISS_00007_.png" }]);
  assert.equal(restored.outputName, "HEISS_00007_ (1).png");
  assert.equal(restored.url, `/comfy/view?${new URLSearchParams({ filename: "HEISS_00007_ (1).png", subfolder: "heiss-ui", type: "output" })}`);
  assert.deepEqual(fs.readFileSync(path.join(comfyOutput, "heiss-ui", "HEISS_00007_ (1).png")), png);
  assert.equal(fs.readFileSync(path.join(comfyOutput, "heiss-ui", "HEISS_00007_.png"), "utf8"), "another image");
  assert.equal(restored.prompt, "a far pier");
  assert.equal(vault.vaultItems(key).length, 0);
});
