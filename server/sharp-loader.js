/**
 * sharp, loaded on first use. Its native binary can be missing (antivirus
 * quarantined it, or an install skipped the win32 build); importing it eagerly
 * would then stop the whole server from starting, when all that is lost is
 * image resizing. Resolves to null in that case and says so once.
 */
let loading = null;

export function loadSharp() {
  loading ||= import("sharp").then(
    (module) => module.default,
    (error) => {
      console.warn(
        `\n  [HEISS] Image resizing is off: sharp could not load (${error.message.split("\n")[0]}).\n` +
        "  Thumbnails show the full images, and uploaded reference images are kept unresized.\n" +
        "  To fix it, run `npm install --omit=dev` in the HEISS UI folder, then restart.\n"
      );
      return null;
    }
  );
  return loading;
}
