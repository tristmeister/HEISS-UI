import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep local setup plug-and-play without adding a runtime dependency. Explicit
// shell environment variables always win over values in .env.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

try {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1] in process.env) continue;
    const value = match[2].replace(/^(["'])(.*)\1$/, "$2");
    process.env[match[1]] = value;
  }
} catch {
  // .env is optional.
}

export function writeLocalEnvValue(key, value) {
  const safeKey = String(key || "").trim();
  const safeValue = String(value || "").trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(safeKey) || /[\r\n]/.test(safeValue)) throw new Error("Invalid local setting.");
  let lines = [];
  try { lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/); } catch {}
  const matcher = new RegExp(`^\\s*${safeKey.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*=`);
  let replaced = false;
  lines = lines.map((line) => {
    if (!matcher.test(line)) return line;
    replaced = true;
    return `${safeKey}=${safeValue}`;
  });
  if (!replaced) lines.push(`${safeKey}=${safeValue}`);
  fs.writeFileSync(envPath, `${lines.filter((line, index, all) => line || index < all.length - 1).join("\n")}\n`, { mode: 0o600 });
  process.env[safeKey] = safeValue;
}
