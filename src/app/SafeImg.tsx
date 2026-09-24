import React, { useState } from 'react';

type SafeImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src?: string | null;
  /** Shown instead when there is no source or it fails to load. Nothing by default. */
  fallback?: React.ReactNode;
};

/**
 * An <img> for sources that can go missing: outputs, thumbnails, previews,
 * anything served by ComfyUI or the gallery. When it has no source or the load
 * fails, it renders `fallback` instead of the browser's broken-image icon and
 * alt text. scripts/images.test.js keeps raw <img> tags with dynamic sources out.
 */
export function SafeImg({ src, fallback = null, alt = '', onError, ...props }: SafeImgProps) {
  const [failedSrc, setFailedSrc] = useState('');
  if (!src || failedSrc === src) return <>{fallback}</>;
  return (
    <img
      {...props}
      src={src}
      alt={alt}
      onError={(event) => {
        setFailedSrc(src);
        onError?.(event);
      }}
    />
  );
}
