import React from 'react';

/**
 * The solid arrow from the setup hero, reused for every upscale affordance so
 * the tile, the viewer and the dialogs all speak with one mark. Drawn filled
 * with a round-joined stroke of its own colour so the corners stay soft at
 * small sizes, where a hairline icon reads as washed out.
 */
export function UpscaleArrow({ size = 15 }: { size?: number }) {
  return (
    <svg
      className="upscale-arrow"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.6 20.6 12.4H15.8V20.4H8.2V12.4H3.4Z" />
    </svg>
  );
}
