/**
 * ComfyUI's own converter, run on this server: a headless browser opens the
 * ComfyUI page, loads the canvas workflow with `app.loadGraphData()` and asks
 * `app.graphToPrompt()` for the prompt, the exact code ComfyUI runs when you
 * press Queue. Custom nodes' front-end code, subgraphs and everything else
 * ComfyUI's page knows is then handled by ComfyUI itself.
 *
 * It needs Playwright (or playwright-core) and a Chromium. Neither is a
 * dependency of HEISS: when they're missing this quietly returns null and the
 * built-in converter (workflow-convert.js) is used instead. One page is kept
 * warm per ComfyUI address and reloaded after a restart.
 */
import { comfyUrl } from "./comfy.js";

let browserPromise = null;
let page = null;
let pageUrl = "";
let unavailable = false;

async function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      const module = await import(name);
      return module.chromium || module.default?.chromium || null;
    } catch {
      // Try the next.
    }
  }
  return null;
}

async function browser() {
  if (unavailable) return null;
  browserPromise ||= (async () => {
    const chromium = await loadPlaywright();
    if (!chromium) {
      unavailable = true;
      return null;
    }
    const executablePath = process.env.HEISS_CHROMIUM || undefined;
    return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }).catch(() => {
      unavailable = true;
      return null;
    });
  })();
  return browserPromise;
}

async function readyPage(timeout) {
  const instance = await browser();
  if (!instance) return null;
  if (page && pageUrl === comfyUrl && !page.isClosed()) {
    const alive = await page.evaluate(() => Boolean(window.app?.graphToPrompt)).catch(() => false);
    if (alive) return page;
  }
  await page?.close().catch(() => {});
  page = await instance.newPage();
  pageUrl = comfyUrl;
  await page.goto(comfyUrl, { waitUntil: "domcontentloaded", timeout });
  await page.waitForFunction(() => Boolean(window.app?.graphToPrompt && window.app?.loadGraphData), null, { timeout });
  return page;
}

/** The API prompt for a canvas workflow, from ComfyUI's own page; null when that isn't possible here. */
export async function convertWithComfyPage(visual, { timeout = 20_000 } = {}) {
  try {
    const current = await readyPage(timeout);
    if (!current) return null;
    const output = await current.evaluate(async (workflow) => {
      await window.app.loadGraphData(workflow, true, false);
      const result = await window.app.graphToPrompt();
      return result?.output || null;
    }, visual);
    return output && typeof output === "object" && Object.keys(output).length ? output : null;
  } catch {
    // A failed page is rebuilt next time.
    await page?.close().catch(() => {});
    page = null;
    return null;
  }
}

/** Drops the warm page (after a ComfyUI restart, so the new nodes' front-end code loads). */
export async function resetComfyPage() {
  await page?.close().catch(() => {});
  page = null;
}
