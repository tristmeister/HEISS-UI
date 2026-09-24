import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { isInside, pathKey, samePath } from "./paths.js";

test("a drive root contains its files on Windows", () => {
  const pathApi = path.win32;
  assert.equal(isInside("D:\\", "D:\\image.png", { pathApi }), true);
  assert.equal(isInside("D:\\", "D:\\sub\\image.png", { pathApi }), true);
  assert.equal(isInside("D:\\", "E:\\image.png", { pathApi }), false);
  assert.equal(isInside("D:\\", "D:\\", { pathApi }), false);
  assert.equal(isInside("D:\\", "D:\\", { pathApi, orSame: true }), true);
});

test("Windows paths compare without case, and escapes stay out", () => {
  const pathApi = path.win32;
  assert.equal(isInside("D:\\AI\\Output", "d:\\ai\\output\\x.png", { pathApi }), true);
  assert.equal(isInside("D:\\AI\\Output", "D:\\AI\\Output2\\x.png", { pathApi }), false);
  assert.equal(isInside("D:\\AI\\Output", "D:\\AI\\Output\\..\\x.png", { pathApi }), false);
  assert.equal(isInside("D:\\AI\\Output", "D:\\AI\\Output\\..foo.png", { pathApi }), true);
  assert.equal(samePath("d:/ai/models", "D:\\AI\\Models", pathApi), true);
  assert.equal(pathKey("D:\\AI", pathApi), "d:\\ai");
});

test("POSIX paths keep their case", () => {
  const pathApi = path.posix;
  assert.equal(isInside("/", "/x.png", { pathApi }), true);
  assert.equal(isInside("/data/Out", "/data/out/x.png", { pathApi }), false);
  assert.equal(isInside("/data/out", "/data/out/sub/x.png", { pathApi }), true);
  assert.equal(isInside("/data/out", "/data/outside/x.png", { pathApi }), false);
});
