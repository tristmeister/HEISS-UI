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
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.4 21.4 12.6H16.6V20.6H7.4V12.6H2.6Z" />
    </svg>
  );
}
