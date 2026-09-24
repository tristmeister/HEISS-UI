import fs from "node:fs";
import path from "node:path";

/**
 * Path checks that hold on Windows too. `startsWith(base + sep)` breaks for a
 * drive root (`D:\` + `\` is `D:\\`), and Windows paths ignore case, so these
 * compare through path.relative, case-insensitively on win32. `pathApi` is only
 * there so tests can pass path.win32 or path.posix.
 */

const isWin = (pathApi) => pathApi.sep === "\\";

/** A comparison key for a path: resolved, and lowercased where the file system ignores case. */
export function pathKey(value, pathApi = path) {
  const resolved = pathApi.resolve(String(value || ""));
  return isWin(pathApi) ? resolved.toLowerCase() : resolved;
}

export function samePath(a, b, pathApi = path) {
  return pathKey(a, pathApi) === pathKey(b, pathApi);
}

/** Whether `file` is inside `base` (or is `base` itself, with `orSame`). */
export function isInside(base, file, { orSame = false, pathApi = path } = {}) {
  if (!base || !file) return false;
  const rel = pathApi.relative(pathKey(base, pathApi), pathKey(file, pathApi));
  if (!rel) return orSame;
  return rel !== ".." && !rel.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(rel);
}

/** Free space where the models would land; the nearest existing parent answers for a folder not made yet. */
export function freeBytesAt(dir) {
  if (!dir || typeof fs.statfsSync !== "function") return null;
  let current = path.resolve(dir);
  for (let depth = 0; depth < 8; depth += 1) {
    try {
      const stats = fs.statfsSync(current);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
  return null;
}
