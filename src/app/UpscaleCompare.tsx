import React, { useCallback, useRef, useState } from 'react';
import type { GalleryItem } from './types';

/**
 * Original against upscale, split by a line that follows the pointer. No drag:
 * moving across the image sweeps the reveal, which makes a quick A/B read
 * cheaper than grabbing a handle.
 */
export function UpscaleCompare({ item }: { item: GalleryItem }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [tracking, setTracking] = useState(false);

  // The split lives inside the letterboxed image box, so the pointer has to be
  // measured against that box - not the full-width stage it is centred in.
  const track = useCallback((clientX: number) => {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    if (!rect.width) return;
    setPosition(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  // Keyboard users get the same sweep without a pointer.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") { setPosition((value) => Math.max(0, value - step)); event.preventDefault(); }
    if (event.key === "ArrowRight") { setPosition((value) => Math.min(100, value + step)); event.preventDefault(); }
  };

  return (
    <div
      className="upscale-compare"
      style={{ "--compare-position": `${position}%`, "--compare-ratio": `${item.width || 1} / ${item.height || 1}` } as React.CSSProperties}
      onPointerMove={(event) => { setTracking(true); track(event.clientX); }}
      onPointerDown={(event) => { event.stopPropagation(); track(event.clientX); }}
      onPointerLeave={() => setTracking(false)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Compare the original with the upscale"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(position)}
    >
      <div className="upscale-compare-frame" ref={frameRef}>
        <img className="upscale-compare-image" src={item.url} alt="" draggable={false} />
        <div className="upscale-compare-reveal">
          <img className="upscale-compare-image" src={item.upscale?.url} alt="" draggable={false} />
        </div>
        <div className={`upscale-compare-line${tracking ? " is-tracking" : ""}`} aria-hidden="true"><span /></div>
        <span className="upscale-compare-tag is-before">Original</span>
        <span className="upscale-compare-tag is-after">Upscaled{item.upscale?.scale ? ` ${item.upscale.scale}x` : ""}</span>
      </div>
    </div>
  );
}
