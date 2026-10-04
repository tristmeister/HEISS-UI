import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { SafeImg } from './SafeImg';
import { observeVideoPreview, refreshVideoPreviews, videoPreviewUrl } from './videoPreviewScheduler';

/** Silent, low-resolution server proxy; the original is never loaded by a tile. */
export function VideoPreview({ source }: { source: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [load, setLoad] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [posterReady, setPosterReady] = useState(false);
  const preview = videoPreviewUrl(source);
  useEffect(() => {
    if (!video.current) return;
    return observeVideoPreview(video.current, setLoad);
  }, []);
  useEffect(() => {
    setFailed(false); setReady(false); setPosterReady(false);
  }, [source]);
  useEffect(() => {
    // Clearing src alone can leave an old network request/decoder alive in Safari.
    if (!load) setReady(false);
    video.current?.load();
    refreshVideoPreviews();
  }, [load, preview, failed]);
  return (
    <div className={`video-preview${ready ? ' is-ready' : ''}`}>
      <SafeImg className="video-preview-poster" src={preview ? `${preview}${preview.includes('?') ? '&' : '?'}poster=1` : ''} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setPosterReady(true)} />
      <video ref={video} src={load && preview && !failed ? preview : undefined} muted playsInline loop preload={load ? 'auto' : 'none'}
        disablePictureInPicture disableRemotePlayback draggable={false} aria-hidden="true"
        onLoadedData={() => setReady(true)} onError={() => setFailed(true)} />
      {!ready && !posterReady ? <span className="video-preview-placeholder"><Play size={22} /><span>{failed ? 'Video' : 'Preview'}</span></span> : null}
    </div>
  );
}
