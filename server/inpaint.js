import { bytesForReference, uploadBufferToComfy } from "./reference-assets.js";
import { loadSharp } from "./sharp-loader.js";

/**
 * Inpainting: change only the part of a reference image the user painted.
 *
 * The model never sees the whole picture. HEISS crops the painted area with a
 * band of context around it, the graph regenerates that crop with a latent
 * noise mask (so only the painted part is repainted), and ImageCompositeMasked
 * lays the result back onto the original pixels as ComfyUI loaded them. The
 * rest of the image is never VAE encoded or decoded, so it stays exact.
 */

// The nodes every inpaint graph needs on top of the family's own; all are ComfyUI core.
export const inpaintNodes = ["SetLatentNoiseMask", "DifferentialDiffusion", "LoadImageMask", "ImageScale", "ImageCompositeMasked", "RepeatImageBatch", "RepeatLatentBatch", "SplitSigmasDenoise"];

const maxMaskBytes = 16 * 1024 * 1024;
// Below this a painted pixel is a stray brush edge, not part of the mask.
const maskThreshold = 26;
const contextFactor = 1.6;
const minContext = 512;
const snap = 16;
// Past this share of the picture, cropping saves nothing: work on the whole image.
const wholeImageShare = 0.7;

/** The painted pixels' bounding box in a one-channel buffer, or null when nothing was painted. */
export function maskBounds(data, width, height, threshold = maskThreshold) {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x] < threshold) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function snapUp(value, step = snap) {
  return Math.ceil(value / step) * step;
}

/**
 * Where to crop and how big to sample. The box is the painted area grown by a
 * band of context, at least `minContext` a side, kept inside the image; its
 * size snaps to 16 so model and mask stay aligned. The working size is the box
 * scaled to the pixel count the user picked, also on the 16 grid.
 */
export function inpaintGeometry({ imageWidth, imageHeight, bounds, targetPixels }) {
  const sideFor = (painted, limit) => {
    const grown = Math.max(painted * contextFactor, Math.min(minContext, limit));
    return Math.min(limit, snapUp(grown));
  };
  let width = sideFor(bounds.width, imageWidth);
  let height = sideFor(bounds.height, imageHeight);
  const whole = width * height >= imageWidth * imageHeight * wholeImageShare;
  if (whole) {
    width = imageWidth;
    height = imageHeight;
  }
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const x = whole ? 0 : Math.round(Math.min(Math.max(0, centerX - width / 2), imageWidth - width));
  const y = whole ? 0 : Math.round(Math.min(Math.max(0, centerY - height / 2), imageHeight - height));
  const pixels = Math.max(256 * 256, Number(targetPixels) || 1024 * 1024);
  const scale = Math.sqrt(pixels / (width * height));
  const workWidth = Math.max(snap * 16, Math.round(width * scale / snap) * snap);
  const workHeight = Math.max(snap * 16, Math.round(height * scale / snap) * snap);
  return { box: { x, y, width, height }, work: { width: workWidth, height: workHeight } };
}

/** How far the seam fades, from the 0–1 "edge softness" setting, for a box this size. */
export function featherSigma(softness, box) {
  const side = Math.min(box.width, box.height);
  return Math.max(0.6, Math.min(1, Math.max(0, Number(softness) || 0)) * side * 0.04);
}

export function maskBufferFromDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ""));
  if (!match) throw new Error("The painted mask didn’t come through. Paint it again.");
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > maxMaskBytes) throw new Error("The painted mask is too large.");
  return buffer;
}

/**
 * The three files an inpaint run loads, from the source image and the painted
 * mask (any size; it is stretched over the image): the crop at working size,
 * the mask it samples with, and the mask that stitches it back at box size.
 * Null when nothing was painted. Each sharp step runs on its own, since sharp
 * orders the operations in one pipeline its own way.
 */
export async function inpaintFiles(sharp, sourceBuffer, maskBuffer, { targetPixels, feather }) {
  // ComfyUI's LoadImage applies EXIF orientation, and so did the browser the mask was painted in.
  const { data: rgb, info } = await sharp(sourceBuffer, { limitInputPixels: 80_000_000 }).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const imageWidth = info.width;
  const imageHeight = info.height;
  const mask = await sharp(maskBuffer)
    .resize(imageWidth, imageHeight, { fit: "fill", kernel: "linear" })
    .extractChannel(0)
    .raw()
    .toBuffer();
  const bounds = maskBounds(mask, imageWidth, imageHeight);
  if (!bounds) return null;
  const { box, work } = inpaintGeometry({ imageWidth, imageHeight, bounds, targetPixels });
  const region = { left: box.x, top: box.y, width: box.width, height: box.height };
  // sharp writes a one-channel input back out as RGB unless told otherwise.
  const gray = (buffer, width, height) => sharp(buffer, { raw: { width, height, channels: 1 } });
  const rawGray = (pipeline) => pipeline.extractChannel(0).raw().toBuffer();
  const pngGray = (pipeline) => pipeline.toColourspace("b-w").png().toBuffer();

  const crop = await sharp(rgb, { raw: { width: imageWidth, height: imageHeight, channels: info.channels } })
    .extract(region)
    .resize(work.width, work.height, { fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer();
  const boxMask = await rawGray(gray(mask, imageWidth, imageHeight).extract(region));
  // Sampling: grown a little and soft, so differential diffusion eases the change in at the edge.
  const workMask = await rawGray(gray(boxMask, box.width, box.height).resize(work.width, work.height, { fit: "fill" }));
  const softened = await rawGray(gray(workMask, work.width, work.height).blur(Math.max(1, Math.min(work.width, work.height) * 0.012)));
  const samplingMask = await pngGray(gray(softened, work.width, work.height).linear(2.2, 0));
  // Stitching: at the box's own size, feathered by the edge-softness setting.
  const compositeMask = await pngGray(gray(boxMask, box.width, box.height).blur(featherSigma(feather, box)));
  return { box, work, crop, samplingMask, compositeMask };
}

/**
 * Turns the job's painted mask into what the graph loads and stages it in
 * ComfyUI. Returns null when nothing was painted, so the run goes ahead as a
 * plain edit.
 */
export async function prepareInpaint(req, body) {
  const reference = body.referenceAssets?.[0];
  if (!body.inpaint?.mask || !reference?.assetId || !reference.comfyName) return null;
  const sharp = await loadSharp();
  if (!sharp) throw new Error("Inpainting needs image resizing, which is off: sharp could not load. Run `npm install --omit=dev` in the HEISS UI folder, then restart.");
  const source = await bytesForReference(req, reference.assetId);
  const files = await inpaintFiles(sharp, source.buffer, maskBufferFromDataUrl(body.inpaint.mask), {
    targetPixels: Number(body.width) * Number(body.height),
    feather: body.inpaint.feather
  });
  if (!files) return null;
  // A Hidden image's crop gets its own name, so cleaning up after the run never touches another job's input.
  const unique = Boolean(body.privateVault) || String(reference.assetId).startsWith("vault:");
  const upload = (buffer, name) => uploadBufferToComfy({ buffer, mime: "image/png", name }, { unique });
  const crop = await upload(files.crop, "inpaint-crop.png");
  const mask = await upload(files.samplingMask, "inpaint-mask.png");
  const composite = await upload(files.compositeMask, "inpaint-stitch.png");
  return {
    original: reference.comfyName,
    crop: crop.comfyName,
    mask: mask.comfyName,
    composite: composite.comfyName,
    box: files.box,
    work: files.work,
    strength: body.inpaint.strength,
    feather: body.inpaint.feather
  };
}

/** The staged file names an inpaint run adds, for cleanup after Hidden runs. */
export function inpaintInputNames(inpaint) {
  return inpaint ? [inpaint.crop, inpaint.mask, inpaint.composite].filter(Boolean) : [];
}
