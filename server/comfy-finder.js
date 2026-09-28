import { normalizeComfyUrl } from "./comfy.js";
import { isThisComputer } from "./hardware.js";

/**
 * Where ComfyUI usually listens on this computer: a manual or portable install
 * on 8188, ComfyUI Desktop on 8000. When the saved address (or the default)
 * does not answer and points at this computer, HEISS looks at these too and
 * keeps whichever answers, so nobody has to know about ports.
 */
export const usualComfyAddresses = ["http://127.0.0.1:8188", "http://127.0.0.1:8000"];

const SEARCH_EVERY_MS = 8000;

/** "localhost:8188" and "127.0.0.1:8188" are the same place. */
function samePlace(a, b) {
  const key = (value) => {
    try {
      const url = new URL(normalizeComfyUrl(value));
      const host = ["localhost", "::1", "[::1]"].includes(url.hostname) ? "127.0.0.1" : url.hostname;
      return `${host}:${url.port || (url.protocol === "https:" ? "443" : "80")}${url.pathname}`;
    } catch {
      return String(value);
    }
  };
  return key(a) === key(b);
}

/** The usual addresses worth trying instead of `current`: none when it is another computer's. */
export function nearbyAddresses(current, candidates = usualComfyAddresses) {
  if (!isThisComputer(current)) return [];
  return candidates.filter((candidate) => !samePlace(candidate, current));
}

/** Whether a /system_stats answer came from ComfyUI, not some other server on that port. */
export function looksLikeComfy(stats) {
  return Boolean(stats && typeof stats === "object" && stats.system && Array.isArray(stats.devices));
}

async function probeComfy(url) {
  try {
    const response = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(1500) });
    return response.ok && looksLikeComfy(await response.json());
  } catch {
    return false;
  }
}

/** The first usual address that answers as ComfyUI, or "". */
export async function findComfy({ current, candidates = usualComfyAddresses, probe = probeComfy } = {}) {
  for (const candidate of nearbyAddresses(current, candidates)) {
    if (await probe(candidate)) return candidate;
  }
  return "";
}

/**
 * findComfy for the status poll: at most once every few seconds, however many
 * tabs and devices are polling, and one search at a time.
 */
let lastSearch = 0;
let running = null;
export function findComfyNow(current, { now = Date.now(), probe } = {}) {
  if (running) return running;
  if (now - lastSearch < SEARCH_EVERY_MS) return Promise.resolve("");
  lastSearch = now;
  running = findComfy({ current, probe }).finally(() => { running = null; });
  return running;
}
