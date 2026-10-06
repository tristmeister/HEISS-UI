import React, { useEffect, useRef, useState } from 'react';
import { Rows3 } from 'lucide-react';
import { Sheet } from './PhoneStudio';
import { Media } from './components';
import { Still, modelName, runKind, timeSpan } from './RunStack';
import { haptic } from './phoneControls';
import { runTitle, type Run } from './runs';
import type { GalleryItem } from './types';

/**
 * A run on a phone: a sheet with the run as a cover flow you swipe through,
 * the one in the middle facing you and the rest turned away to either side.
 * Tap the one in front to open it; "Show in gallery" lays the run out in the
 * grid instead.
 */
export function RunSheet({ run, onClose, openItem, onShowInGallery }: {
  run: Run | null;
  onClose: () => void;
  openItem: (item: GalleryItem) => void;
  onShowInGallery: (run: Run) => void;
}) {
  // Kept while the sheet slides away, so it doesn't empty mid-exit.
  const last = useRef<Run | null>(run);
  if (run) last.current = run;
  const shown = run || last.current;
  return (
    <Sheet open={Boolean(run)} onClose={onClose} title={shown ? runKind(shown) : ""} className="run-sheet">
      {shown ? <CoverFlow run={shown} onOpen={(item) => { onClose(); openItem(item); }} onShowInGallery={() => { haptic("tap"); onShowInGallery(shown); }} /> : null}
    </Sheet>
  );
}

function CoverFlow({ run, onOpen, onShowInGallery }: { run: Run; onOpen: (item: GalleryItem) => void; onShowInGallery: () => void }) {
  const items = run.items.filter((item) => item.status === "done");
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // Each card turns by how far it is from the middle; worked out on scroll,
  // straight onto the cards, so React isn't asked to render every frame.
  useEffect(() => {
    const element = track.current;
    if (!element) return;
    let frame = 0;
    let last = -1;
    const paint = () => {
      frame = 0;
      const middle = element.scrollLeft + element.clientWidth / 2;
      let nearest = 0;
      let nearestDistance = Infinity;
      element.querySelectorAll<HTMLElement>(".cover-flow-card").forEach((card, position) => {
        const center = card.offsetLeft + card.offsetWidth / 2;
        const distance = (center - middle) / card.offsetWidth;
        const clamped = Math.max(-2.2, Math.min(2.2, distance));
        const turn = Math.max(-1, Math.min(1, clamped));
        card.style.setProperty("--turn", String(turn));
        card.style.setProperty("--away", String(Math.min(1.6, Math.abs(clamped))));
        card.style.zIndex = String(100 - Math.round(Math.abs(distance) * 10));
        if (Math.abs(distance) < nearestDistance) { nearestDistance = Math.abs(distance); nearest = position; }
      });
      if (nearest !== last) {
        if (last >= 0) haptic("tap");
        last = nearest;
        setIndex(nearest);
      }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(paint); };
    paint();
    element.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      element.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [items.length]);
  const current = items[index] || items[0];
  const ratio = Number(run.cover.width || 1) / Math.max(1, Number(run.cover.height || 1));
  return (
    <div className="cover-flow" style={{ "--card-ratio": ratio } as React.CSSProperties}>
      <div ref={track} className="cover-flow-track">
        {items.map((item, position) => (
          <button
            key={item.id}
            type="button"
            className="cover-flow-card"
            aria-label={`Open ${position + 1} of ${items.length}`}
            onClick={(event) => {
              if (position === index) { onOpen(item); return; }
              const card = event.currentTarget;
              track.current?.scrollTo({ left: card.offsetLeft + card.offsetWidth / 2 - (track.current.clientWidth / 2), behavior: "smooth" });
            }}
          >
            <span className="cover-flow-face">{Math.abs(position - index) <= 1 ? <Media item={item} muted /> : <Still item={item} />}</span>
          </button>
        ))}
      </div>
      <div className="cover-flow-caption">
        <small>{index + 1} of {items.length}{run.model ? <> · {modelName(run.model)}</> : null} · {timeSpan(run.start, run.end)}</small>
        <strong>{runTitle(run)}</strong>
        {current?.prompt && run.variations > 1 ? <p>{current.prompt}</p> : null}
      </div>
      <button type="button" className="cover-flow-show" onClick={onShowInGallery}>
        <Rows3 size={18} />
        <span>Show in gallery</span>
      </button>
    </div>
  );
}
