import React, { createContext, lazy, Suspense, useContext, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Media } from './components';
import type { GalleryItem } from './types';
import { generationGridCount } from './generationEffect';

export function generationIdentity(item: GalleryItem) {
  return !item.bundle && item.jobId && Number.isInteger(item.index)
    ? `${item.privateVault ? 'vault' : 'gallery'}:${item.jobId}:${item.index}`
    : item.id;
}

/** Keep this surface mounted when a pending record becomes a finished output. */
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
  const pending = item.status === 'pending';
  const advanced = mode === 'advanced' && !reducedMotion;
  useEffect(() => {
    if (pending || resolved || !advanced || item.status !== 'done') lastPending.current = item;
  }, [item, pending, resolved, advanced]);
  const resolving = item.status === 'done' && item.type === 'image' && beganPending.current && advanced && !resolved;
  const source = (muted && item.thumbnailUrl) || item.url;
  const previewItem = pending ? item : lastPending.current;
  return (
    <div className={`generation-surface${pending ? ' is-pending' : ''}${resolving ? ' is-resolving' : ''}`}>
      {item.status === 'done' && item.type === 'image' ? (
        <img src={source} alt={item.filename} draggable={false} className="generation-result"
          onLoad={() => setLoadedSource(source)} onError={() => setResolved(true)} />
      ) : !pending ? <Media item={item} muted={muted} /> : null}
      {pending || resolving ? <GenerationPreview preview={previewItem.preview} fit={fit} aspectRatio={(item.width || 1) / (item.height || 1)}
        finalSource={resolving && loadedSource === source ? source : undefined}
        onResolved={() => setResolved(true)} /> : null}
      {pending ? children : null}
    </div>
  );
}

export const GenerationPreviewMode = createContext<'advanced' | 'simple'>('advanced');
const Mosaic = lazy(() => import('./GenerationMosaic'));

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
  const frameWidth = fit === 'contain' ? Math.min(size.width, size.height * aspectRatio) : size.width;
  const frameHeight = fit === 'contain' ? frameWidth / aspectRatio : size.height;

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
    if (!advanced || !visible || !foreground || !preview || !frameWidth || !frameHeight) return;
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
  }, [advanced, preview, frameWidth, frameHeight, visible, foreground]);

  useEffect(() => {
    if (!finalSource || !visible || !foreground) return;
    // A failed WebGL context or lazy chunk must not trap a finished image.
    const timeout = setTimeout(() => complete.current?.(), 8000);
    return () => clearTimeout(timeout);
  }, [finalSource, visible, foreground]);

  return (
    <div ref={host} className="generation-visual" aria-hidden="true">
      <div className="generation-frame" style={{ width: frameWidth, height: frameHeight }}>
      {preview && (!advanced || pixelFailed) ? <img className="generate-preview" src={preview} alt="" draggable={false} /> : null}
      {advanced ? <canvas ref={canvas} className="generation-pixels" /> : null}
      {advanced && visible && foreground ? (
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
