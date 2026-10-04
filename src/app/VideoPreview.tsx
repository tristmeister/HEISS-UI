import React, { useEffect, useRef, useState } from 'react';
import { Play } from 'lucide-react';
import { observeVideoPreview, refreshVideoPreviews, videoPreviewUrl } from './videoPreviewScheduler';

/** Waits before each new try of a still or preview that didn't load: the server may still be working down its list. */
const RETRY_MS = [3000, 10000, 30000];
const withTry = (url: string, attempt: number, extra = '') => {
  const params = [extra, attempt ? `try=${attempt}` : ''].filter(Boolean).join('&');
  return params ? `${url}${url.includes('?') ? '&' : '?'}${params}` : url;
};

/** One try counter that comes back after a wait, a few times, then gives up. */
function useRetry(source: string) {
  const [attempt, setAttempt] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);
  const timer = useRef(0);
  useEffect(() => { setAttempt(0); setGaveUp(false); return () => window.clearTimeout(timer.current); }, [source]);
  const fail = () => {
    window.clearTimeout(timer.current);
    if (attempt >= RETRY_MS.length) { setGaveUp(true); return; }
    timer.current = window.setTimeout(() => setAttempt((n) => n + 1), RETRY_MS[attempt]);
  };
  return { attempt, gaveUp, fail };
}

/**
 * Silent, sharp-enough server proxy of a video for its grid tile; the original
 * is never loaded by a tile. Its still (cut from the original, so it comes
 * first) shows until the preview plays, and all along while previews are paused.
 */
export function VideoPreview({ source }: { source: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [load, setLoad] = useState(false);
  // What has loaded is kept as the address that loaded, not a flag reset when
  // the source changes: a still from the browser's cache can finish loading
  // before such a reset runs, and the reset then hid it for good.
  const [readySrc, setReadySrc] = useState('');
  const [posterLoaded, setPosterLoaded] = useState('');
  const preview = videoPreviewUrl(source);
  const posterTry = useRetry(preview);
  const videoTry = useRetry(preview);
  useEffect(() => {
    if (!video.current) return;
    return observeVideoPreview(video.current, setLoad);
  }, []);
  const videoSrc = load && preview && !videoTry.gaveUp ? withTry(preview, videoTry.attempt) : undefined;
  const posterSrc = preview && !posterTry.gaveUp ? withTry(preview, posterTry.attempt, 'poster=1') : '';
  const ready = Boolean(videoSrc) && readySrc === videoSrc;
  const posterReady = Boolean(posterSrc) && posterLoaded === posterSrc;
  useEffect(() => {
    // Clearing src alone can leave an old network request/decoder alive in Safari.
    video.current?.load();
    refreshVideoPreviews();
  }, [load, videoSrc]);
  return (
    <div className={`video-preview${ready ? ' is-ready' : ''}`}>
      {posterSrc ? (
        <img
          className="video-preview-poster"
          src={posterSrc}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          style={posterReady ? undefined : { opacity: 0 }}
          onLoad={() => setPosterLoaded(posterSrc)}
          onError={() => posterTry.fail()}
        />
      ) : null}
      <video ref={video} src={videoSrc} muted playsInline loop preload={load ? 'auto' : 'none'}
        disablePictureInPicture disableRemotePlayback draggable={false} aria-hidden="true"
        onLoadedData={() => { if (videoSrc) setReadySrc(videoSrc); }} onError={() => { if (videoSrc) videoTry.fail(); }} />
      {!ready && !posterReady ? <span className="video-preview-placeholder"><Play size={22} /><span>{videoTry.gaveUp && posterTry.gaveUp ? 'Video' : 'Preview'}</span></span> : null}
    </div>
  );
}
