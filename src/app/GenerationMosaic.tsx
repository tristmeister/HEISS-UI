import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ImageGeneration, PRESETS, type ImageGenerationHandle } from 'img-fx';
import { createRevealBitmap, GENERATION_PIXEL_SCALE } from './generationEffect';

// The React API exposes named presets rather than per-instance reveal timing.
// Customize our organic preset once, preserving its loader and pixel grid.
const organic = PRESETS['pixels-organic'];
PRESETS['pixels-organic'] = {
  ...organic,
  modes: {
    ...organic.modes,
    dark: {
      ...organic.modes.dark,
      revealConfig: {
        ...organic.modes.dark.revealConfig,
        duration: 2.25,
        pixDuration: 2.1,
        pixEasing: 'smoothstep',
        softness: 0.6,
      },
    },
  },
};

export default function GenerationMosaic({ finalSource, hasPreview, onResolved }: {
  finalSource?: string;
  hasPreview: boolean;
  onResolved: () => void;
}) {
  const effect = useRef<ImageGenerationHandle>(null);
  const complete = useRef(onResolved);
  const [revealSource, setRevealSource] = useState<string>();
  useEffect(() => { complete.current = onResolved; }, [onResolved]);
  useEffect(() => {
    if (!finalSource) return;
    let canceled = false;
    let objectUrl: string | undefined;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      if (canceled) return;
      const element = effect.current?.element;
      if (!element) { complete.current(); return; }
      try {
        // Match the library's display canvas, including DPR and rounded bounds.
        const shader = element.querySelector<HTMLCanvasElement>('.image-gen-shader');
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bitmap = createRevealBitmap(image, shader?.width || element.clientWidth * dpr, shader?.height || element.clientHeight * dpr);
        bitmap.toBlob((blob) => {
          if (canceled) return;
          if (!blob) { complete.current(); return; }
          objectUrl = URL.createObjectURL(blob);
          setRevealSource(objectUrl);
        }, 'image/png');
      } catch {
        complete.current();
      }
    };
    image.onerror = () => { if (!canceled) complete.current(); };
    image.src = finalSource;
    return () => {
      canceled = true;
      image.onload = null;
      image.onerror = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [finalSource]);
  useEffect(() => {
    if (!revealSource) return;
    // Child effects install the image pool before the imperative reveal runs.
    const frame = requestAnimationFrame(() => effect.current?.triggerReveal({ hold: 'manual' }));
    return () => cancelAnimationFrame(frame);
  }, [revealSource]);
  return <ImageGeneration ref={effect} className="generation-mosaic"
    preset="pixels-organic" theme="dark" pixelScale={GENERATION_PIXEL_SCALE}
    images={revealSource} autoReveal={false} revealInitialDelay={0}
    strength={1} style={{ background: 'transparent', '--generation-shader-strength': hasPreview ? 0.24 : 0.8 } as CSSProperties}
    onCycle={(event) => { if (event.phase === 'visible') complete.current(); }}>
    <div style={{ width: '100%', height: '100%' }} />
  </ImageGeneration>;
}
