/** Release switches for features that are implemented but not yet public. */
// On by default; HEISS_ENABLE_INPAINT=0 turns it off.
export const inpaintingEnabled = process.env.HEISS_ENABLE_INPAINT !== '0';
