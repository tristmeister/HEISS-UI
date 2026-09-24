import assert from "node:assert/strict";
import test from "node:test";
import { renderWordmark, terminalSupport } from "./banner.js";

const strip = (line) => line.replace(/\x1b\[[0-9;]*m/g, "");

test("the large mark is 80 columns and only used when asked", () => {
  const lines = renderWordmark({ depth: 0, large: true });
  assert.equal(lines.length, 7);
  assert.ok(lines.every((line) => line.length <= 80));
});

test("the wordmark fits an 80-column terminal in both styles", () => {
  for (const style of ["braille", "blocks"]) {
    const lines = renderWordmark({ style, depth: 0 });
    assert.ok(lines.length >= 4 && lines.length <= 6, `${style}: ${lines.length} lines`);
    for (const line of lines) assert.ok(strip(line).length <= 76, `${style}: ${strip(line).length} columns`);
    assert.ok(lines.some((line) => line.trim()), `${style} draws something`);
  }
});

test("no colour codes without colour, and every coloured line resets", () => {
  assert.ok(renderWordmark({ depth: 0 }).every((line) => !line.includes("\x1b")));
  assert.ok(renderWordmark({ depth: 24 }).every((line) => line.endsWith("\x1b[0m")));
});

test("a partial reveal shows fewer dots than the full mark", () => {
  const count = (lines) => lines.join("").replace(/[\s⠀]/g, "").length;
  assert.ok(count(renderWordmark({ depth: 0, reveal: 0.3 })) < count(renderWordmark({ depth: 0 })));
});

test("terminal support follows the stream and the environment", () => {
  assert.deepEqual(terminalSupport({ isTTY: false }, {}, "darwin"), { tty: false, depth: 0, style: "braille", animate: false });
  assert.equal(terminalSupport({ isTTY: true }, { NO_COLOR: "1" }, "darwin").depth, 0);
  assert.equal(terminalSupport({ isTTY: true }, { COLORTERM: "truecolor" }, "linux").depth, 24);
  assert.equal(terminalSupport({ isTTY: true }, {}, "win32").style, "blocks");
  assert.equal(terminalSupport({ isTTY: true }, { WT_SESSION: "x" }, "win32").style, "braille");
  assert.equal(terminalSupport({ isTTY: true }, { CI: "true" }, "linux").animate, false);
});
