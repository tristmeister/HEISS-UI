import React, { useEffect, useState } from 'react';

/**
 * The "it just works" moment when ComfyUI comes back while the gallery has
 * images: a small glass card, like pairing AirPods. A pixel plug and socket
 * slide together, the contact flashes warm, and the card says what connected.
 * It leaves by itself. Pure CSS and SVG, so it never depends on WebGL.
 */
const SHOW_MS = 2600;

// Cells of the tiny plug (left) and socket (right), in a 22×9 grid.
const PLUG = [[0, 4], [1, 4], [2, 3], [2, 4], [2, 5], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [6, 6], [6, 7], [7, 2], [8, 2], [7, 6], [8, 6]];
const SOCKET = [[13, 1], [13, 3], [13, 4], [13, 5], [13, 7], [14, 1], [14, 3], [14, 4], [14, 5], [14, 7], [15, 1], [15, 2], [15, 3], [15, 4], [15, 5], [15, 6], [15, 7], [16, 1], [16, 2], [16, 3], [16, 4], [16, 5], [16, 6], [16, 7], [17, 3], [17, 4], [17, 5], [18, 4], [19, 4], [20, 4], [21, 4]];

export function ConnectedCard({ at, device }: { at: number; device?: string }) {
  const [shown, setShown] = useState<number>(0);
  useEffect(() => {
    if (!at) return;
    setShown(at);
    const timer = window.setTimeout(() => setShown(0), SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [at]);
  if (!shown) return null;
  return (
    <div className="connected-card" key={shown} role="status">
      <svg className="connected-glyph" viewBox="0 0 22 9" aria-hidden="true">
        <g className="connected-plug">{PLUG.map(([x, y]) => <rect key={`p${x}-${y}`} x={x + 0.1} y={y + 0.1} width="0.8" height="0.8" rx="0.18" />)}</g>
        <g className="connected-socket">{SOCKET.map(([x, y]) => <rect key={`s${x}-${y}`} x={x + 0.1} y={y + 0.1} width="0.8" height="0.8" rx="0.18" />)}</g>
        <circle className="connected-flash" cx="12" cy="4.5" r="3" />
      </svg>
      <div className="connected-copy">
        <strong>ComfyUI connected</strong>
        <span>{device || 'Ready to generate'}</span>
      </div>
    </div>
  );
}
