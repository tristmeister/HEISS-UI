import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep local setup plug-and-play without adding a runtime dependency. Explicit
// shell environment variables always win over values in .env.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// HEISS_ENV_FILE points at another file (tests use one of their own). Under
// `node --test` (NODE_TEST_CONTEXT) the developer's own .env is never read or
// written: a test would otherwise see their ComfyUI, or save over their settings.
const envPath = process.env.HEISS_ENV_FILE ? path.resolve(process.env.HEISS_ENV_FILE)
  : process.env.NODE_TEST_CONTEXT ? path.join(os.tmpdir(), `heiss-test-env-${process.pid}`)
  : path.join(root, ".env");

/** Keys that came from .env rather than the shell, so a setting knows it may rewrite them. */
export const envFileKeys = new Set();

try {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    process.env[match[1]] = value;
    envFileKeys.add(match[1]);
  }
} catch {
  // .env is optional.
}

function keyMatcher(key) {
  return new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
}

function writeLines(lines) {
  fs.writeFileSync(envPath, `${lines.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`, { mode: 0o600 });
}

/**
 * Takes a setting out of .env altogether. What the process has is left alone
 * unless it came from .env, so a value set in the shell still applies.
 */
export function removeLocalEnvValue(key) {
  const safeKey = String(key || "").trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(safeKey)) throw new Error("Invalid local setting.");
  let lines = [];
  try { lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/); } catch { return false; }
  const matcher = keyMatcher(safeKey);
  const kept = lines.filter((line) => !matcher.test(line));
  if (kept.length !== lines.length) writeLines(kept);
  if (envFileKeys.has(safeKey)) {
    delete process.env[safeKey];
    envFileKeys.delete(safeKey);
  }
  return kept.length !== lines.length;
}

export function writeLocalEnvValue(key, value) {
  const safeKey = String(key || "").trim();
  const safeValue = String(value || "").trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(safeKey) || /[\r\n]/.test(safeValue)) throw new Error("Invalid local setting.");
  let lines = [];
  try { lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/); } catch {}
  const matcher = keyMatcher(safeKey);
  let replaced = false;
  lines = lines.map((line) => {
    if (!matcher.test(line)) return line;
    replaced = true;
    return `${safeKey}=${safeValue}`;
  });
  if (!replaced) lines.push(`${safeKey}=${safeValue}`);
  writeLines(lines);
  process.env[safeKey] = safeValue;
}
