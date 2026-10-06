import React, { useEffect, useRef, useState } from 'react';
import { Container, Controls, PlayButton, Time, TimeSlider, MuteButton, FullscreenButton } from '@videojs/react';
import { Video, VideoPlayer, VideoSkin } from '@videojs/react/video';
import '@videojs/react/video/skin.css';
import { Play, Pause, Volume2, VolumeX, RotateCcw, Maximize, Minimize } from 'lucide-react';
import { usePhone } from './device';
import { suspendVideoPreviews } from './videoPreviewScheduler';
import type { Output } from './types';
import { titleFromPrompt } from './format';
import { mediaUrl } from './mediaUrl';

function PlayerControls({ desktop = false }: { desktop?: boolean }) {
  return (
    <Controls.Root visibility="always">
      <Controls.Content className={`heiss-video-controls${desktop ? ' heiss-video-desktop-controls' : ''}`}>
        <PlayButton className="heiss-video-button" render={(props, state) => <button {...props}>{state.paused ? <Play size={20} /> : <Pause size={20} />}</button>} />
        <div className="heiss-video-timeline">
          <TimeSlider.Root className="heiss-video-slider">
            <TimeSlider.Track className="heiss-video-track"><TimeSlider.Buffer className="heiss-video-buffer" /><TimeSlider.Fill className="heiss-video-fill" /></TimeSlider.Track>
            <TimeSlider.Thumb className="heiss-video-thumb" />
          </TimeSlider.Root>
          {!desktop ? <Time.Group className="heiss-video-time"><Time.Value type="current" /><Time.Separator /><Time.Value type="duration" /></Time.Group> : null}
        </div>
        <MuteButton className="heiss-video-button" render={(props, state) => <button {...props}>{state.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>} />
        {desktop ? <FullscreenButton className="heiss-video-button" render={(props, state) => <button {...props}>{state.fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}</button>} /> : null}
      </Controls.Content>
    </Controls.Root>
  );
}

export default function VideoViewer({ item }: { item: Output & { width?: number; height?: number } }) {
  const phone = usePhone();
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState((item.width || 16) / (item.height || 9));
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => suspendVideoPreviews(), []);
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(host.current);
    const pause = () => { if (document.hidden) host.current?.querySelector('video')?.pause(); };
    document.addEventListener('visibilitychange', pause);
    return () => { observer.disconnect(); document.removeEventListener('visibilitychange', pause); };
  }, []);
  const width = Math.min(size.width, size.height * ratio);
  const frame = { width: width || '100%', height: width ? width / ratio : '100%' };
  // Opening a video plays it. Where the browser won't start it with sound
  // (Safari, a page not clicked yet), it starts muted and the mute button says so.
  // The player settles its own state just after it mounts and can pause the
  // video again then, so this looks once more a moment after starting it.
  useEffect(() => {
    let timer = 0;
    let tries = 0;
    let checked = false;
    const start = () => {
      const v = host.current?.querySelector('video');
      if (!v || v.readyState < 2) { if (tries++ < 100) timer = window.setTimeout(start, 100); return; }
      if (document.hidden) return;
      if (v.paused) v.play().catch(() => { v.muted = true; return v.play(); }).catch(() => { /* Blocked outright: the play button is there. */ });
      if (!checked) { checked = true; timer = window.setTimeout(start, 400); }
    };
    start();
    return () => window.clearTimeout(timer);
  }, [item.url, attempt]);
  const media = <Video src={mediaUrl(item.url, item as { id?: string; createdAt?: string })} playsInline disablePictureInPicture disableRemotePlayback loop preload="auto" onLoadedMetadata={(event) => {
    const v = event.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight);
  }} onError={() => setError('This video couldn’t be played. Try again, or save the original using the viewer actions.')} />;
  return (
    <div ref={host} className="heiss-video-viewer" data-video-viewer
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      onKeyDownCapture={(e) => {
        // Left and right step through the gallery, as they do for pictures, rather
        // than seek: the player never sees them, and the viewer gets them from the window.
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        e.stopPropagation();
        e.preventDefault();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: e.key }));
      }}
      onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}>
      <VideoPlayer key={`${item.url}:${attempt}`} title={titleFromPrompt(item.prompt || item.filename)}>
        {phone ? <Container className="heiss-phone-video" style={frame}>{media}<PlayerControls /></Container> : <VideoSkin className="heiss-desktop-video" style={frame}>{media}<PlayerControls desktop /></VideoSkin>}
      </VideoPlayer>
      {error ? <div className="heiss-video-error" role="alert"><p>{error}</p><button type="button" onClick={() => { setError(''); setAttempt((n) => n + 1); }}><RotateCcw size={16} />Try again</button></div> : null}
    </div>
  );
}
