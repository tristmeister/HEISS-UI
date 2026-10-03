import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { familyGraph } from "./family-graph.js";
import { featherSigma, inpaintFiles, inpaintGeometry, inpaintNodes, maskBounds, maskBufferFromDataUrl } from "./inpaint.js";

const objectInfo = JSON.parse(fs.readFileSync(new URL("./fixtures/object_info-comfyui-0.34.1.json", import.meta.url), "utf8"));
const byType = (graph, type) => Object.values(graph).filter((item) => item.class_type === type);
const inpaint = {
  original: "original.png", crop: "crop.png", mask: "mask.png", composite: "stitch.png",
  box: { x: 96, y: 160, width: 512, height: 640 }, work: { width: 912, height: 1136 }, strength: 1, feather: 0.4
};

/** Every node is one this ComfyUI has, and every link points at a node in the graph. */
function assertWired(graph) {
  for (const [id, node] of Object.entries(graph)) {
    assert.ok(objectInfo[node.class_type] || node.class_type === "TextEncodeQwenImage21", `${id}: ${node.class_type} is not a ComfyUI node`);
    for (const value of Object.values(node.inputs)) {
      if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string") assert.ok(graph[value[0]], `${id} links to missing node ${value[0]}`);
    }
  }
}

test("the inpaint nodes are all ComfyUI core nodes", () => {
  for (const node of inpaintNodes) assert.ok(objectInfo[node], node);
});

test("mask bounds find the painted pixels and ignore faint brush edges", () => {
  const width = 10;
  const data = new Uint8Array(width * 8);
  assert.equal(maskBounds(data, width, 8), null);
  data[2 * width + 3] = 255;
  data[5 * width + 6] = 200;
  data[7 * width + 9] = 10;
  assert.deepEqual(maskBounds(data, width, 8), { x: 3, y: 2, width: 4, height: 4 });
});

test("the crop grows the painted area by context, stays inside the image and snaps to 16", () => {
  const { box, work } = inpaintGeometry({ imageWidth: 2048, imageHeight: 1536, bounds: { x: 1900, y: 40, width: 100, height: 120 }, targetPixels: 1024 * 1024 });
  assert.deepEqual(box, { x: 1536, y: 0, width: 512, height: 512 }, "at least 512 a side, pushed back inside the right and top edges");
  assert.equal(work.width % 16, 0);
  assert.equal(work.height % 16, 0);
  assert.ok(Math.abs(work.width * work.height - 1024 * 1024) < 1024 * 1024 * 0.05, "sampled at the picked pixel count");

  const big = inpaintGeometry({ imageWidth: 1024, imageHeight: 1024, bounds: { x: 100, y: 100, width: 700, height: 700 }, targetPixels: 1024 * 1024 });
  assert.deepEqual(big.box, { x: 0, y: 0, width: 1024, height: 1024 }, "a mask over most of the picture works on all of it");

  const small = inpaintGeometry({ imageWidth: 400, imageHeight: 300, bounds: { x: 10, y: 10, width: 20, height: 20 }, targetPixels: 1024 * 1024 });
  assert.deepEqual(small.box, { x: 0, y: 0, width: 400, height: 300 }, "an image smaller than the minimum context is used whole");
});

test("feathering scales with the box and never drops to a hard edge", () => {
  assert.equal(featherSigma(0, { width: 512, height: 512 }), 0.6);
  assert.ok(featherSigma(1, { width: 1024, height: 1024 }) > featherSigma(1, { width: 512, height: 512 }));
});

test("only a PNG data URL is read as a mask", () => {
  assert.throws(() => maskBufferFromDataUrl("data:image/jpeg;base64,AAAA"), /didn’t come through/);
  assert.equal(maskBufferFromDataUrl("data:image/png;base64,AAAA").length, 3);
});

test("img2img inpainting samples the crop with a noise mask at the inpaint strength and stitches it back", () => {
  const graph = familyGraph({ family: "zimage", variant: "turbo", source: "unet", model: "z_image_turbo.safetensors", encoders: ["qwen_3_4b.safetensors"], vae: "ae.safetensors", prompt: "a red jacket", steps: 8, cfg: 1, seed: 1, width: inpaint.work.width, height: inpaint.work.height, count: 2, startImageComfy: "crop.png", inpaint: { ...inpaint, strength: 0.8 } });
  assertWired(graph);
  // A hard sampling mask, no differential diffusion: few-step models leave a soft edge half-done.
  assert.equal(byType(graph, "DifferentialDiffusion").length, 0);
  assert.equal(byType(graph, "SetLatentNoiseMask").length, 1);
  assert.equal(byType(graph, "KSampler")[0].inputs.denoise, 0.8);
  assert.equal(byType(graph, "EmptySD3LatentImage").length, 0);
  assert.deepEqual(byType(graph, "LoadImageMask").map((item) => [item.inputs.image, item.inputs.channel]), [["mask.png", "red"], ["stitch.png", "red"]]);
  const [stitch] = byType(graph, "ImageCompositeMasked");
  assert.deepEqual([stitch.inputs.x, stitch.inputs.y, stitch.inputs.resize_source], [96, 160, false]);
  assert.equal(graph[stitch.inputs.destination[0]].class_type, "RepeatImageBatch", "two variations get two copies of the original");
  assert.deepEqual(byType(graph, "ImageScale")[0].inputs.width, 512);
  const [save] = byType(graph, "SaveImage");
  assert.equal(graph[save.inputs.images[0]].class_type, "ImageCompositeMasked");
  assert.equal(byType(graph, "LoadImage").map((item) => item.inputs.image).sort().join(","), "crop.png,original.png");
});

test("Flux.2 Klein inpaints from its first reference's latent and trims the schedule for partial strength", () => {
  const body = { family: "flux2_klein_4b", variant: "distilled", source: "unet", model: "flux-2-klein-4b.safetensors", encoders: ["qwen_3_4b.safetensors"], vae: "flux2-vae.safetensors", prompt: "make it red", steps: 4, cfg: 1, seed: 1, width: 912, height: 1136, referenceImages: ["crop.png", "style.png"] };
  const full = familyGraph({ ...body, inpaint });
  assertWired(full);
  const [noiseMask] = byType(full, "SetLatentNoiseMask");
  assert.equal(full[noiseMask.inputs.samples[0]].class_type, "VAEEncode", "the crop's encoded reference is the starting latent");
  assert.equal(byType(full, "ReferenceLatent").length, 4, "both references still guide both conditionings");
  assert.equal(byType(full, "EmptyFlux2LatentImage").length, 0);
  assert.equal(byType(full, "SplitSigmasDenoise").length, 0);

  const partial = familyGraph({ ...body, inpaint: { ...inpaint, strength: 0.6 } });
  assertWired(partial);
  const [split] = byType(partial, "SplitSigmasDenoise");
  assert.equal(split.inputs.denoise, 0.6);
  assert.deepEqual(byType(partial, "SamplerCustomAdvanced")[0].inputs.sigmas[1], 1, "the low end of the split schedule");
});

test("Qwen-Image 2.1 repaints the crop's own pixels, with the crop as its reference", () => {
  const graph = familyGraph({ family: "qwen_image_21", variant: "standard", source: "unet", model: "qwen_image_2.1.safetensors", encoders: ["qwen3vl_8b.safetensors"], vae: "qwen_image_21_vae.safetensors", prompt: "make it red", negative: "", steps: 25, cfg: 1, seed: 1, width: 912, height: 1136, referenceImages: ["crop.png"], inpaint });
  assertWired(graph);
  const [noiseMask] = byType(graph, "SetLatentNoiseMask");
  // The encoder's latent is a canvas at its own framing, not the picture: start from the crop itself.
  const encode = graph[noiseMask.inputs.samples[0]];
  assert.equal(encode.class_type, "VAEEncode");
  assert.equal(graph[encode.inputs.pixels[0]].inputs.image, inpaint.crop);
  const [encoder] = byType(graph, "TextEncodeQwenImage21");
  assert.equal(graph[encoder.inputs["images.image_1"][0]].inputs.image, "crop.png");
  assert.equal(byType(graph, "ImageCompositeMasked").length, 1);
});

test("without a mask nothing changes", () => {
  const graph = familyGraph({ family: "zimage", variant: "turbo", source: "unet", model: "z_image_turbo.safetensors", encoders: ["qwen_3_4b.safetensors"], vae: "ae.safetensors", prompt: "a cat", steps: 8, cfg: 1, seed: 1, inpaint: null });
  for (const node of ["DifferentialDiffusion", "SetLatentNoiseMask", "ImageCompositeMasked"]) assert.equal(byType(graph, node).length, 0, node);
});

test("the files: an exact crop, a hard grown sampling mask and a feathered stitch mask", async () => {
  const sharp = (await import("sharp")).default;
  const width = 1600;
  const height = 1200;
  // A left-to-right gradient, so the crop's position can be read back from its pixels.
  const rgb = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rgb.fill(Math.floor(x / width * 255), (y * width + x) * 3, (y * width + x) * 3 + 3);
  const source = await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer();
  // Painted at a quarter of the image's size: a square at (1000–1200, 400–600) in image pixels.
  const maskRaw = Buffer.alloc(400 * 300);
  for (let y = 100; y < 150; y += 1) maskRaw.fill(255, y * 400 + 250, y * 400 + 300);
  const mask = await sharp(maskRaw, { raw: { width: 400, height: 300, channels: 1 } }).png().toBuffer();

  const files = await inpaintFiles(sharp, source, mask, { targetPixels: 1024 * 1024, feather: 0.4 });
  // The painted square, centered in a 512 box (the upscaled mask's soft edge can shift it a pixel).
  assert.deepEqual([files.box.width, files.box.height], [512, 512]);
  assert.ok(Math.abs(files.box.x - 844) <= 2 && Math.abs(files.box.y - 244) <= 2, JSON.stringify(files.box));
  const crop = await sharp(files.crop).metadata();
  assert.deepEqual([crop.width, crop.height], [files.work.width, files.work.height]);
  const { data: cropLeft } = await sharp(files.crop).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(Math.abs(cropLeft[0] - Math.floor(files.box.x / width * 255)) <= 2, "the crop starts where the box does");

  const stitch = await sharp(files.compositeMask).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([stitch.info.width, stitch.info.height], [512, 512]);
  const at = (x, y) => stitch.data[y * 512 + x];
  assert.equal(at(256, 256), 255, "the painted middle is fully replaced");
  assert.equal(at(5, 5), 0, "the context band keeps the original");
  assert.ok(at(156 - 3, 256) > 0 && at(156 - 3, 256) < 255, "the edge fades");

  const sampling = await sharp(files.samplingMask).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const scale = files.work.width / 512;
  assert.equal(sampling.data[Math.round(256 * scale) * files.work.width + Math.round(256 * scale)], 255);
  assert.equal(sampling.data[Math.round(256 * scale) * files.work.width + Math.round(150 * scale)], 255, "grown a little past the painted edge, at full strength");
  assert.ok(sampling.data.every((value) => value === 0 || value === 255), "hard: on or off, no half-way edge");

  const empty = await sharp(Buffer.alloc(400 * 300), { raw: { width: 400, height: 300, channels: 1 } }).png().toBuffer();
  assert.equal(await inpaintFiles(sharp, source, empty, { targetPixels: 1024 * 1024, feather: 0.4 }), null);
});
