import { loadSharp } from './sharp-loader.js';

/** Shrink to a pixel budget, preserving framing and never enlarging either side. */
export function inputImageSize(width, height, pixels, step = 1) {
  if (![width, height, pixels].every((value) => Number.isFinite(value) && value > 0)) throw new Error('The input image size could not be read.');
  if (width * height <= pixels) return { width, height };
  const scale = Math.sqrt(pixels / (width * height));
  const snap = (side) => Math.max(1, Math.floor(side * scale / step) * step);
  return { width: snap(width), height: snap(height) };
}

/** Only the generation copy is changed; PNG preserves alpha used as a LoadImage mask. */
export async function prepareInputImage(bytes, { pixels, step = 1 } = {}) {
  if (!pixels) return bytes;
  const sharp = await loadSharp();
  if (!sharp) throw new Error('Automatic input resizing is unavailable. Repair the HEISS UI installation, or turn off automatic input resizing in Settings → Generation.');
  const metadata = await sharp(bytes.buffer, { limitInputPixels: 80_000_000 }).metadata();
  if (metadata.pages > 1) throw new Error('Use a still image as a start or reference image.');
  const oriented = metadata.autoOrient || (metadata.orientation >= 5 && metadata.orientation <= 8
    ? { width: metadata.height, height: metadata.width } : metadata);
  const size = inputImageSize(oriented.width, oriented.height, pixels, step);
  if (size.width === oriented.width && size.height === oriented.height) return { ...bytes, ...size };
  const { data, info } = await sharp(bytes.buffer, { limitInputPixels: 80_000_000 }).rotate()
    .resize(size.width, size.height, { fit: 'fill', kernel: 'lanczos3', withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  return { ...bytes, buffer: data, mime: 'image/png', name: String(bytes.name || 'input').replace(/\.[^.]+$/, '') + '.png', width: info.width, height: info.height, resized: true };
}
