import React from 'react';

/**
 * The solid arrow from the setup hero, reused for every upscale affordance so
 * the tile, the viewer and the dialogs all speak with one mark. Drawn filled
 * with a round-joined stroke of its own colour so the corners stay soft at
 * small sizes, where a hairline icon reads as washed out.
 *
 * The path is placed so the arrow's visual mass (head plus shaft), not its
 * bounding box, sits on the centre of the 24 unit box. A bounding-box-centred
 * arrow looks low: the solid shaft outweighs the pointed tip.
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
      <path d="M12 3.04 20.6 11.84H15.8V19.84H8.2V11.84H3.4Z" />
    </svg>
  );
}
