import React, { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Media } from './components';
import type { GalleryItem } from './types';
import { generationGridCount, webglMosaicAllowed } from './generationEffect';
import { upscaleDisplayThumbnail, upscaleDisplayUrl } from './useUpscale';
import { SafeImg } from './SafeImg';
import { mediaUrl } from './mediaUrl';

export function generationIdentity(item: GalleryItem) {
  return !item.run && item.jobId && Number.isInteger(item.index)
    ? `${item.privateVault ? 'vault' : 'gallery'}:${item.jobId}:${item.index}`
    : item.id;
}

/** Keep this surface mounted when a pending record becomes a finished output. */
type InpaintPreview = { box: { x: number; y: number; width: number; height: number }; image: { width: number; height: number }; referenceId: string };

/** An inpaint run's crop and the picture it sits in, when the run recorded both (server/gallery-store.js). */
function inpaintPreviewOf(item: GalleryItem): InpaintPreview | null {
  const value = (item.settings as Record<string, unknown> | undefined)?.inpaint as Partial<InpaintPreview> | undefined;
  if (!value?.box || !value.image?.width || !value.image?.height || !value.referenceId) return null;
  return value as InpaintPreview;
}

export function GenerationMedia({ item, muted = false, fit = 'cover', children }: React.PropsWithChildren<{ item: GalleryItem; muted?: boolean; fit?: 'cover' | 'contain' }>) {
  return <GenerationMediaInstance key={generationIdentity(item)} item={item} muted={muted} fit={fit}>{children}</GenerationMediaInstance>;
}

function GenerationMediaInstance({ item, muted, fit, children }: React.PropsWithChildren<{ item: GalleryItem; muted: boolean; fit: 'cover' | 'contain' }>) {
  const mode = useContext(GenerationPreviewMode);
  const reducedMotion = useReducedMotion();
  const beganPending = useRef(item.status === 'pending');
  const lastPending = useRef(item);
  const [resolved, setResolved] = useState(false);
  const [loadedSource, setLoadedSource] = useState('');
  const [useFullImage, setUseFullImage] = useState(false);
  // The finished file would not load (moved, deleted, ComfyUI unreachable): hand it to Media's fallback.
  const [failedSource, setFailedSource] = useState('');
  const pending = item.status === 'pending';
  const advanced = mode === 'advanced' && !reducedMotion;
  useEffect(() => {
    if (pending || resolved || !advanced || item.status !== 'done') lastPending.current = item;
  }, [item, pending, resolved, advanced]);
  // An inpaint run previews in place: over its original, only where the painted crop is being made.
  const inpaint = inpaintPreviewOf(item);
  const resolving = item.status === 'done' && item.type === 'image' && beganPending.current && advanced && !resolved && !inpaint;
  const displayUrl = upscaleDisplayUrl(item);
  const displayThumbnail = upscaleDisplayThumbnail(item);
  useEffect(() => setUseFullImage(false), [displayUrl, displayThumbnail]);
  const isThumbnail = muted && Boolean(displayThumbnail) && !useFullImage;
  // Unique to this item, so a reused file name never brings back an older picture (mediaUrl.ts).
  const source = mediaUrl(isThumbnail ? displayThumbnail! : displayUrl, item);
  const previewItem = pending ? item : lastPending.current;
  return (
    <div className={`generation-surface${pending ? ' is-pending' : ''}${resolving ? ' is-resolving' : ''}`}>
      {item.status === 'done' && item.type === 'image' && source && failedSource !== source ? (
        <img src={source} alt={muted ? "" : item.prompt ? `Generated from: ${item.prompt.slice(0, 160)}` : "Generated image"} draggable={false} className="generation-result"
          onLoad={() => setLoadedSource(source)}
          onError={() => {
            if (isThumbnail) { setUseFullImage(true); return; }
            setFailedSource(source);
            setResolved(true);
          }} />
      ) : !pending ? <Media item={item} muted={muted} /> : null}
      {pending && inpaint ? (
        <div className="generation-inpaint" aria-hidden="true">
          <SafeImg className="generation-inpaint-base" src={`/api/reference-assets/${encodeURIComponent(inpaint.referenceId)}/media`} draggable={false} />
          <div className="generation-inpaint-box" style={{
            left: `${(inpaint.box.x / inpaint.image.width) * 100}%`,
            top: `${(inpaint.box.y / inpaint.image.height) * 100}%`,
            width: `${(inpaint.box.width / inpaint.image.width) * 100}%`,
            height: `${(inpaint.box.height / inpaint.image.height) * 100}%`
          }}>
            <GenerationPreview preview={previewItem.preview} fit="cover" aspectRatio={inpaint.box.width / inpaint.box.height} />
          </div>
        </div>
      ) : pending || resolving ? <GenerationPreview preview={previewItem.preview} fit={fit} aspectRatio={(item.width || 1) / (item.height || 1)}
        finalSource={resolving && loadedSource === source ? source : undefined}
        onResolved={() => setResolved(true)} /> : null}
      {pending ? children : null}
    </div>
  );
}

export const GenerationPreviewMode = createContext<'advanced' | 'simple'>('advanced');
const Mosaic = lazy(() => import('./GenerationMosaic'));

const webglMosaic = webglMosaicAllowed();

class EffectBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

/** A single latest-frame buffer; incoming previews never create an animation queue. */
export function GenerationPreview({ preview, fit = 'cover', aspectRatio = 1, finalSource, onResolved }: { preview?: string; fit?: 'cover' | 'contain'; aspectRatio?: number; finalSource?: string; onResolved?: () => void }) {
  const mode = useContext(GenerationPreviewMode);
  const reducedMotion = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const complete = useRef(onResolved);
  useEffect(() => { complete.current = onResolved; }, [onResolved]);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(!document.hidden);
  const [pixelFailed, setPixelFailed] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const advanced = mode === 'advanced' && !reducedMotion;
  const reveal2d = advanced && !webglMosaic && Boolean(finalSource);
  // Whole device pixels, so the frame and its cells never straddle a pixel.
  const dpr = window.devicePixelRatio || 1;
  const snap = (value: number) => Math.round(value * dpr) / dpr;
  const frameWidth = snap(fit === 'contain' ? Math.min(size.width, size.height * aspectRatio) : size.width);
  const frameHeight = snap(fit === 'contain' ? frameWidth / aspectRatio : size.height);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    const resize = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    if (host.current) observer.observe(host.current);
    if (host.current) resize.observe(host.current);
    const update = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => { observer.disconnect(); resize.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, []);

  useEffect(() => {
    // Leave the last step frame untouched throughout the native shader reveal.
    if (!advanced || reveal2d || !visible || !foreground || !preview || !frameWidth || !frameHeight) return;
    let stale = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    const paint = (loaded: HTMLImageElement) => {
      if (stale || !canvas.current) return;
      const target = canvas.current;
      const context = target.getContext('2d');
      if (!context) { setPixelFailed(true); return; }
      setPixelFailed(false);
      // img-fx pixels-organic: base 6 + cellSize(.22) * 74, reference 320 CSS px.
      // Match its physical square-cell grid, including rounding on each axis.
      target.width = generationGridCount(frameWidth);
      target.height = generationGridCount(frameHeight);
      const imageRatio = loaded.naturalWidth / loaded.naturalHeight;
      const frameRatio = frameWidth / frameHeight;
      const sw = imageRatio > frameRatio ? loaded.naturalHeight * frameRatio : loaded.naturalWidth;
      const sh = imageRatio > frameRatio ? loaded.naturalHeight : loaded.naturalWidth / frameRatio;
      context.drawImage(loaded, (loaded.naturalWidth - sw) / 2, (loaded.naturalHeight - sh) / 2, sw, sh, 0, 0, target.width, target.height);
    };
    image.onload = () => paint(image);
    image.onerror = () => { if (!stale) setPixelFailed(true); };
    image.src = preview;
    return () => { stale = true; image.onload = null; image.onerror = null; };
  }, [advanced, reveal2d, preview, frameWidth, frameHeight, visible, foreground]);

  useEffect(() => {
    // The WebGL-free reveal: the finished image sharpens out of the preview's
    // cell grid by doubling the resolution each step, then hands over.
    if (!reveal2d || !finalSource || !visible || !foreground || !frameWidth || !frameHeight) return;
    let stale = false;
    let timer = 0;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const target = canvas.current;
      const context = target?.getContext('2d');
      if (stale) return;
      if (!target || !context) { complete.current?.(); return; }
      const fullWidth = Math.max(1, Math.round(frameWidth * dpr));
      const fullHeight = Math.max(1, Math.round(frameHeight * dpr));
      const imageRatio = image.naturalWidth / image.naturalHeight;
      const frameRatio = frameWidth / frameHeight;
      const sw = imageRatio > frameRatio ? image.naturalHeight * frameRatio : image.naturalWidth;
      const sh = imageRatio > frameRatio ? image.naturalHeight : image.naturalWidth / frameRatio;
      let width = generationGridCount(frameWidth);
      let height = generationGridCount(frameHeight);
      const step = () => {
        if (stale) return;
        target.width = Math.min(width, fullWidth);
        target.height = Math.min(height, fullHeight);
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, 0, 0, target.width, target.height);
        if (width >= fullWidth && height >= fullHeight) { timer = window.setTimeout(() => complete.current?.(), 260); return; }
        width *= 2;
        height *= 2;
        timer = window.setTimeout(step, 190);
      };
      step();
    };
    image.onerror = () => { if (!stale) complete.current?.(); };
    image.src = finalSource;
    return () => { stale = true; clearTimeout(timer); image.onload = null; image.onerror = null; };
  }, [reveal2d, finalSource, frameWidth, frameHeight, dpr, visible, foreground]);

  useEffect(() => {
    if (!finalSource || !visible || !foreground) return;
    // A failed WebGL context or lazy chunk must not trap a finished image.
    const timeout = setTimeout(() => complete.current?.(), 8000);
    return () => clearTimeout(timeout);
  }, [finalSource, visible, foreground]);

  return (
    <div ref={host} className="generation-visual" aria-hidden="true">
      <div className="generation-frame" style={{ width: frameWidth, height: frameHeight }}>
      {!advanced || pixelFailed ? <SafeImg className="generate-preview" src={preview} draggable={false} /> : null}
      {advanced ? <canvas ref={canvas} className="generation-pixels" /> : null}
      {advanced && webglMosaic && visible && foreground ? (
        <EffectBoundary>
          <Suspense fallback={null}>
            <Mosaic finalSource={finalSource} hasPreview={!!preview} onResolved={() => complete.current?.()} />
          </Suspense>
        </EffectBoundary>
      ) : null}
      </div>
    </div>
  );
}
