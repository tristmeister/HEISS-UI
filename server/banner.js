/**
 * The startup banner: the HEISS UI wordmark as a dot mosaic, like the one in
 * Settings › About, with an ember glow at the foot of the I.
 *
 * Braille cells give real dots (2×4 per character), large when the terminal
 * is wide enough. Fonts without Braille (the classic Windows console) get
 * half blocks instead. Colour follows the
 * terminal: 24-bit where it is known to work, 256 colours otherwise, none for
 * NO_COLOR or a pipe. A real terminal also gets a short reveal.
 */

const GLYPHS = {
  H: ["X...X", "X...X", "X...X", "XXXXX", "X...X", "X...X", "X...X"],
  E: ["XXXXX", "X....", "X....", "XXXX.", "X....", "X....", "XXXXX"],
  I: ["XXX", ".X.", ".X.", ".X.", ".X.", ".X.", "XXX"],
  S: [".XXXX", "X....", "X....", ".XXX.", "....X", "....X", "XXXX."],
  U: ["X...X", "X...X", "X...X", "X...X", "X...X", "X...X", ".XXX."],
  " ": ["..", "..", "..", "..", "..", "..", ".."]
};
const TEXT = "HEISS UI";
const ROWS = 7;

/** Letter pixels as a grid of booleans, one column gap between letters. */
function letterGrid() {
  const rows = Array.from({ length: ROWS }, () => []);
  [...TEXT].forEach((ch, index) => {
    GLYPHS[ch].forEach((row, r) => {
      rows[r].push(...[...row].map((bit) => bit === "X"));
      if (index < TEXT.length - 1) rows[r].push(false);
    });
  });
  return rows;
}

// Where the ember sits, in letter pixels: the foot of the first I.
const EMBER_X = 12;

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Colour of a dot at (u, v) in letter pixels, 0..1 channels, with heat 0..1. */
function dotColor(u, v, heat) {
  const shade = 0.72 - 0.3 * (v / ROWS);
  const dx = (u - EMBER_X) / 5.5;
  const dy = (ROWS - v) / 3.2;
  const warm = Math.min(1, heat * Math.exp(-(dx * dx + dy * dy)) * 1.25);
  const fire = warm > 0.7 ? [1, 0.86, 0.6] : warm > 0.4 ? [1, 0.55, 0.18] : [0.85, 0.3, 0.08];
  return [0, 1, 2].map((i) => shade + (fire[i] - shade) * Math.min(1, warm * 1.4));
}

function colorCode(rgb, depth) {
  if (depth === 24) {
    const [r, g, b] = rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255));
    return `\x1b[38;2;${r};${g};${b}m`;
  }
  // xterm 256: the 6×6×6 cube is close enough for a gray-to-ember ramp.
  const [r, g, b] = rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 5));
  return `\x1b[38;5;${16 + 36 * r + 6 * g + b}m`;
}

/**
 * The wordmark as lines of text. `reveal` 0..1 develops the dots in a noisy
 * sweep from the left; `heat` sets the ember.
 */
export function renderWordmark({ style = "braille", depth = 24, reveal = 1, heat = 1, large = false } = {}) {
  const grid = letterGrid();
  const width = grid[0].length;
  const shown = (u, v) => reveal >= 1 || reveal * 1.6 - u / width - hash(u, v) * 0.35 > 0;
  const lines = [];

  if (style === "braille") {
    // Square letter pixels that line up with the 2×4 Braille cell: 4×4 dots
    // (two characters, one line) when there is room, else 2×2.
    const SUB = large ? 4 : 2;
    const dotsW = width * SUB;
    const dotsH = ROWS * SUB;
    const on = (x, y) => y < dotsH && x < dotsW && grid[Math.floor(y / SUB)][Math.floor(x / SUB)] && shown(x / SUB, y / SUB);
    const bits = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
    for (let cy = 0; cy < dotsH; cy += 4) {
      let line = "";
      let last = "";
      for (let cx = 0; cx < dotsW; cx += 2) {
        let code = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 2; dx++) if (on(cx + dx, cy + dy)) code |= bits[dy][dx];
        if (!code) { line += " "; continue; }
        const color = depth ? colorCode(dotColor((cx + 1) / SUB, Math.min(ROWS - 0.5, (cy + 2) / SUB), heat), depth) : "";
        if (color !== last) { line += color; last = color; }
        line += String.fromCharCode(0x2800 + code);
      }
      lines.push(line + (depth ? "\x1b[0m" : ""));
    }
    return lines;
  }

  // Half blocks: one character is one pixel wide and two tall.
  for (let v = 0; v < ROWS; v += 2) {
    let line = "";
    let last = "";
    for (let u = 0; u < width; u++) {
      const top = grid[v][u] && shown(u, v);
      const bottom = v + 1 < ROWS && grid[v + 1][u] && shown(u, v + 1);
      if (!top && !bottom) { line += " "; continue; }
      const color = depth ? colorCode(dotColor(u + 0.5, v + 1, heat), depth) : "";
      if (color !== last) { line += color; last = color; }
      line += top && bottom ? "█" : top ? "▀" : "▄";
    }
    lines.push(line + (depth ? "\x1b[0m" : ""));
  }
  return lines;
}

/** What this terminal can show. */
export function terminalSupport(stream = process.stdout, env = process.env, platform = process.platform) {
  const tty = Boolean(stream?.isTTY);
  const forced = env.FORCE_COLOR && env.FORCE_COLOR !== "0";
  let depth = 0;
  if (!env.NO_COLOR && (tty || forced)) {
    const truecolor = /truecolor|24bit/i.test(env.COLORTERM || "") || Boolean(env.WT_SESSION) || /iTerm|vscode|WezTerm|ghostty/i.test(env.TERM_PROGRAM || "");
    depth = truecolor ? 24 : 8;
  }
  // The classic Windows console font has block elements but no Braille.
  const braille = platform !== "win32" || Boolean(env.WT_SESSION) || env.TERM_PROGRAM === "vscode";
  return { tty, depth, style: braille ? "braille" : "blocks", animate: tty && !env.CI };
}

const dim = (text, depth) => (depth ? `\x1b[2m${text}\x1b[22m` : text);
const ember = (text, depth) => (depth ? `${colorCode([1, 0.55, 0.18], depth)}${text}\x1b[39m` : text);

/** Print the banner and where HEISS UI is listening. Resolves once drawn. */
export function printBanner({ version = "", url = "", comfyUrl = "" } = {}, stream = process.stdout) {
  const support = terminalSupport(stream);
  const { depth, style } = support;
  // The large Braille mark is 80 columns wide plus the margin.
  const large = style === "braille" && (stream.columns || 0) >= 86;
  const pad = "  ";
  const info = [
    "",
    `${pad}${dim("local studio for ComfyUI", depth)}${version ? dim(`  ·  v${version}`, depth) : ""}`,
    "",
    `${pad}${ember("➜", depth)}  Open      ${url}`,
    `${pad}${dim("➜", depth)}  ComfyUI   ${dim(comfyUrl, depth)}`,
    ""
  ];
  const write = (lines) => stream.write(lines.map((line) => `${pad}${line}`).join("\n") + "\n");

  if (!support.animate) {
    stream.write("\n");
    write(renderWordmark({ style, depth, large }));
    stream.write(info.join("\n") + "\n");
    return Promise.resolve();
  }

  // A quick develop-and-ignite, redrawn in place: about half a second.
  const frames = 14;
  const height = renderWordmark({ style, depth, large }).length;
  stream.write("\n");
  return new Promise((resolve) => {
    let frame = 0;
    const tick = () => {
      const k = frame / frames;
      if (frame > 0) stream.write(`\x1b[${height}A`);
      write(renderWordmark({ style, depth, large, reveal: Math.min(1, k * 1.25), heat: Math.max(0, k * 1.4 - 0.4) }));
      if (frame++ < frames) { setTimeout(tick, 36); return; }
      stream.write(info.join("\n") + "\n");
      resolve();
    };
    tick();
  });
}
