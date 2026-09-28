import React from 'react';
import { encode } from 'uqr';
import { cn } from './format';

/**
 * A QR code drawn as one SVG path, square modules like the app's pixel marks.
 * Encoded here in the browser (uqr, MIT), so it works with no internet at all.
 * Dark on white with a quiet border, because that is what phone cameras read
 * best, whatever the theme around it.
 */
export function QrCode({ value, label, className }: { value: string; label: string; className?: string }) {
  const { path, size } = React.useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) => {
      let x = 0;
      while (x < row.length) {
        if (!row[x]) { x += 1; continue; }
        // Runs of dark modules become one rectangle, which keeps the path short.
        let end = x;
        while (end < row.length && row[end]) end += 1;
        d += `M${x} ${y}h${end - x}v1h${x - end}z`;
        x = end;
      }
    });
    return { path: d, size: qr.size };
  }, [value]);
  return (
    <svg className={cn('qr-code', className)} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#0b0b0b" />
    </svg>
  );
}
