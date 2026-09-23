import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import type { GalleryItem } from './types';

// How close to the line (CSS px) a press grabs it instead of panning.
const GRAB_RADIUS = 22;

/**
 * The original on the left, the upscale on the right, split by a line you
 * place. It lives in the viewer's canvas and shares its zoom: scroll, pinch or
 * click to zoom, drag to pan, and both layers move as one while the split
 * stays put on screen.
 *
 * The line only moves when asked: drag its handle (or drag anywhere at fit),
 * or use the arrow keys. It never chases the pointer, so reaching for the
 * toolbar leaves it where it was. Moves go straight to a CSS variable, not
 * React state, so it tracks without lag.
 */
export function UpscaleCompare({ item, zoomed }: { item: GalleryItem; zoomed: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const position = useRef(50);
  const drag = useRef<{ id: number; x: number; moved: boolean; handle: boolean } | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef(0);
  const [valueNow, setValueNow] = useState(50);

  const apply = useCallback((next: number) => {
    const value = Math.min(100, Math.max(0, next));
    position.current = value;
    const root = rootRef.current;
    if (!root) return;
    root.style.setProperty('--compare-position', `${value}%`);
    // A side pushed almost out of view drops its tag.
    root.dataset.edge = value < 12 ? 'start' : value > 88 ? 'end' : '';
  }, []);

  useEffect(() => { apply(50); setValueNow(50); }, [item.id, apply]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const percentAt = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    return rect?.width ? ((clientX - rect.left) / rect.width) * 100 : position.current;
  };
  const nearLine = (clientX: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect?.width) return false;
    return Math.abs(clientX - (rect.left + (rect.width * position.current) / 100)) <= GRAB_RADIUS;
  };
  const setState = (state: '' | 'near' | 'dragging') => {
    if (rootRef.current) rootRef.current.dataset.state = state;
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const handle = nearLine(event.clientX);
    // Zoomed in, a press away from the line belongs to the viewer: it pans.
    if (!handle && zoomed) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, moved: false, handle };
    if (handle) setState('dragging');
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) {
      if (event.pointerType !== 'touch') setState(nearLine(event.clientX) ? 'near' : '');
      return;
    }
    if (!current.moved && Math.abs(event.clientX - current.x) > 3) {
      current.moved = true;
      setState('dragging');
    }
    if (!current.moved && !current.handle) return;
    const clientX = event.clientX;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => apply(percentAt(clientX)));
  };

  const endDrag = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    // Land exactly where the pointer let go; the last move may not have been drawn yet.
    if (current.moved || (current.handle && event.clientX !== current.x)) {
      cancelAnimationFrame(frame.current);
      apply(percentAt(event.clientX));
    }
    // A drag is not a click: keep the viewer from zooming on release.
    if (current.moved || current.handle) {
      suppressClick.current = true;
      window.setTimeout(() => { suppressClick.current = false; }, 0);
    }
    setState(event.pointerType !== 'touch' && nearLine(event.clientX) ? 'near' : '');
    setValueNow(Math.round(position.current));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    const moves: Record<string, number> = { ArrowLeft: -step, ArrowRight: step, Home: -100, End: 100 };
    if (!(event.key in moves)) return;
    // The viewer uses the arrows for the next image; here they move the line.
    event.preventDefault();
    event.stopPropagation();
    apply(position.current + moves[event.key]);
    setValueNow(Math.round(position.current));
  };

  return (
    <div
      ref={rootRef}
      className="upscale-compare"
      style={{ '--compare-ratio': (item.width || 1) / (item.height || 1) } as React.CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => { if (!drag.current) setState(''); }}
      // Pointer events fire first; once a line drag has started, keep the viewer's touch pan out of it.
      onTouchStart={(event) => { if (drag.current) event.stopPropagation(); }}
      onClickCapture={(event) => { if (suppressClick.current) { event.stopPropagation(); event.preventDefault(); } }}
      onDoubleClick={(event) => { if (nearLine(event.clientX)) { event.stopPropagation(); apply(50); setValueNow(50); } }}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="slider"
      aria-label="Split between the original and the upscale"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valueNow}
      aria-valuetext={`${valueNow}% original`}
    >
      <div className="upscale-compare-frame" ref={frameRef}>
        {/* The upscale underneath; the original is revealed from the left, under its tag. */}
        <img className="upscale-compare-image" src={item.upscale?.url} alt="" draggable={false} />
        <div className="upscale-compare-reveal">
          <img className="upscale-compare-image" src={item.url} alt="" draggable={false} />
        </div>
        <div className="upscale-compare-line" aria-hidden="true">
          <span><ChevronsLeftRight size={15} strokeWidth={2.2} /></span>
        </div>
        <span className="upscale-compare-tag is-before">Original</span>
        <span className="upscale-compare-tag is-after">Upscaled{item.upscale?.scale ? ` ${item.upscale.scale}×` : ''}</span>
      </div>
    </div>
  );
}
