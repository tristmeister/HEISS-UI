import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

function sources(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.(tsx|jsx)$/.test(entry.name) ? [file] : [];
  });
}

/** The whole JSX opening tag from `start`, skipping any `>` inside {…} expressions. */
function jsxTag(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return text.slice(start, index + 1);
  }
  return text.slice(start);
}

// A raw <img> whose source can go missing shows the browser's broken-image
// icon and its alt text. Use SafeImg, or handle onError yourself.
test("images with a dynamic source handle a failed load", () => {
  const offenders = [];
  for (const file of sources(src)) {
    if (path.basename(file) === "SafeImg.tsx") continue;
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(/<img\b/g)) {
      const tag = jsxTag(text, match.index);
      if (!/\bsrc=\{/.test(tag) || /\bonError=/.test(tag)) continue;
      const line = text.slice(0, match.index).split("\n").length;
      offenders.push(`${path.relative(src, file)}:${line}`);
    }
  }
  assert.deepEqual(offenders, [], `Use <SafeImg> (src/app/SafeImg.tsx) for these images:\n${offenders.join("\n")}`);
});
