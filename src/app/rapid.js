// HEISS Rapid in the composer (docs/rapid.md): whether the next run asks for
// it, and what the composer says about it. Plain JavaScript so `node --test`
// can check it without a build step; the types live beside it in rapid.d.ts.
//
// Rapid changes how a seed frames, so a fixed seed and Rapid only go together
// when the seed came from a picture made with Rapid ("Use settings"): then the
// same picture comes back. A seed you typed, or one from a picture made
// without Rapid, makes the run without it. A random seed always gets it.

/**
 * @param {{ capabilities?: { rapid?: boolean, rapidInstall?: boolean } } | null | undefined} profile
 * @param {{ rapid?: boolean }} prefs
 * @param {string} seed the composer's seed ("" is random)
 * @param {string} rapidSeed the seed "Use settings" restored from a Rapid picture, or ""
 * @param {{ kind?: string, startImage?: boolean, inpaint?: boolean }} [run]
 */
export function rapidState(profile, prefs, seed, rapidSeed, run = {}) {
  const capabilities = profile?.capabilities || {};
  if (run.kind === "video" || (!capabilities.rapid && !capabilities.rapidInstall)) return { use: false, status: "model" };
  if (!capabilities.rapid) return { use: false, status: "install" };
  if (prefs?.rapid === false) return { use: false, status: "off" };
  if (run.startImage || run.inpaint) return { use: false, status: "image" };
  const fixed = String(seed || "").trim();
  if (fixed && fixed !== String(rapidSeed || "").trim()) return { use: false, status: "seed" };
  return { use: true, status: "on" };
}

/** The composer's word for it. */
export function rapidLabel(status) {
  return {
    on: "On",
    off: "Off",
    seed: "Off while the seed is fixed",
    image: "Off with a start image",
    install: "Needs the HEISS UI Nodes",
    model: "Not for this model"
  }[status] || "";
}

/** The seed "Use settings" should remember for Rapid: the picture's own, when Rapid made it. */
export function rapidSeedFrom(settings, { vary = false } = {}) {
  if (vary || !settings?.rapid) return "";
  const seed = String(settings.seed || "").trim();
  return /^\d+$/.test(seed) ? seed : "";
}
