import { fallbackAspectPresets } from './constants';
import { clampText, settingMax } from './format';
import { touchCenter, touchDistance } from './gallery';
import { normalizeLoras } from './loras';
import type React from 'react';
import { flushSync } from 'react-dom';
import { toast } from './toast';
import { wheelPixels } from './wheel';
import type { GalleryItem, Profile, TouchGesture } from './types';
import { MAX_ZOOM, MIN_ZOOM, Velocity, anchoredPan as anchorPan, clampPan, liveTransform, measureViewer, paint, rubber, rubberPan, rubberZoom, type Pan } from './viewerGesture';

/** Where an object-fit: contain image actually draws inside its box. */
function containedRect(media: HTMLImageElement | HTMLVideoElement) {
  const box = media.getBoundingClientRect();
  const naturalW = media instanceof HTMLImageElement ? media.naturalWidth : media.videoWidth;
  const naturalH = media instanceof HTMLImageElement ? media.naturalHeight : media.videoHeight;
  if (!naturalW || !naturalH || !box.width || !box.height) return box;
  const scale = Math.min(box.width / naturalW, box.height / naturalH);
  const w = naturalW * scale;
  const h = naturalH * scale;
  return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, right: box.left + (box.width + w) / 2, bottom: box.top + (box.height + h) / 2 };
}

export function useViewerControls(view: any) {
  const {
    active, doneGallery, generate, generateDisabled, height, lastTapRef,
    models, prefs, setActive, setCfg, setClipType, setCount, setCustomSize, setDenoise, setFps,
    setFrames, setHeight, setIsDraggingViewer, setLoras, setMode, setModel, setNegative, setPrompt,
    setSampler, setScheduler, setSeed, setShowDetails, setStartImage, setStartImageId, setStartImageName, setSteps,
    setTextEncoder, setTextEncoders, setVae, setViewerPan, setViewerZoom, setWeightDtype, setWidth,
    setZenSelectedId, showToast, viewerDragEndRef, viewerDragRef, viewerPan,
    viewerZoom, visibleGallery, width, zenItem, zenStripDragRef, zenStripRef
  } = view;
  const lastTouchRef = view.lastTouchRef as React.MutableRefObject<number>;
  const touchGestureRef = view.touchGestureRef as React.MutableRefObject<TouchGesture | null>;
  function resetViewer() {
    setViewerZoom(1);
    setViewerPan({ x: 0, y: 0 });
  }

  function openItem(item: GalleryItem) {
    resetViewer();
    setZenSelectedId(item.id);
    // The side panel squeezes the image below laptop widths, so it starts closed there.
    setShowDetails(typeof window === "undefined" ? true : !window.matchMedia("(max-width: 1024px)").matches);
    setActive(item);
  }

  /** Puts back what "Apply settings" replaced: the draft someone was halfway through. */
  function restoreDraft(before: any) {
    setMode(before.mode);
    setModel(before.model);
    // Switching workflow resets its defaults in an effect; restore the rest after it ran.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setPrompt(before.prompt);
      setNegative(before.negative);
      setSeed(before.seed);
      setWidth(before.width);
      setHeight(before.height);
      setSteps(before.steps);
      setCfg(before.cfg);
      setCount(before.count);
      setLoras(before.loras);
    }));
  }

  /**
   * Loads an output's prompt and settings into the composer. `vary` is for
   * "Vary this": a new seed and no toast, since a new image follows at once.
   * Returns whether its model is installed.
   */
  function applyAllSettings(item: GalleryItem, { vary = false }: { vary?: boolean } = {}) {
    const before = view.draft ? { ...view.draft } : null;
    const itemSettings = item.settings || {};
    const nextMode = item.type;
    const matchingProfile = models?.profiles.find((profile: Profile) => profile.kind === nextMode && profile.model === item.model);
    const matchingAspects = matchingProfile?.aspectPresets?.length ? matchingProfile.aspectPresets : fallbackAspectPresets[nextMode];
    setMode(nextMode);
    if (matchingProfile) setModel(matchingProfile.id);
    const nextPromptLimit = settingMax(matchingProfile?.constraints?.prompt);
    const nextNegativeLimit = settingMax(matchingProfile?.constraints?.negative);
    setPrompt(clampText(item.prompt || "", nextPromptLimit));
    setNegative(clampText(item.negative || "", nextNegativeLimit));
    setWidth(Number(item.width || itemSettings.width || width));
    setHeight(Number(item.height || itemSettings.height || height));
    if (itemSettings.steps) setSteps(Number(itemSettings.steps));
    if (itemSettings.cfg) setCfg(Number(itemSettings.cfg));
    if (itemSettings.denoise) setDenoise(Number(itemSettings.denoise));
    if (itemSettings.seed && itemSettings.seed !== "Random" && !vary) setSeed(String(itemSettings.seed));
    else setSeed("");
    if (itemSettings.count) setCount(Number(itemSettings.count));
    if (itemSettings.frames) setFrames(Number(itemSettings.frames));
    if (itemSettings.fps) setFps(Number(itemSettings.fps));
    if (itemSettings.sampler) setSampler(String(itemSettings.sampler));
    if (itemSettings.scheduler) setScheduler(String(itemSettings.scheduler));
    if (itemSettings.textEncoder) setTextEncoder(String(itemSettings.textEncoder));
    if (Array.isArray(itemSettings.textEncoders)) setTextEncoders?.(itemSettings.textEncoders.map(String));
    else if (itemSettings.textEncoder) setTextEncoders?.([String(itemSettings.textEncoder)]);
    if (itemSettings.vae) setVae(String(itemSettings.vae));
    if (itemSettings.clipType) setClipType(String(itemSettings.clipType));
    if (itemSettings.weightDtype) setWeightDtype(String(itemSettings.weightDtype));
    // Save the stack under the workflow we're switching to, not the one we're leaving.
    setLoras(normalizeLoras(itemSettings.loras), matchingProfile?.id);
    setStartImage(item.referenceImage || "");
    if (setStartImageId) setStartImageId(item.startImageId || item.referenceImage || "");
    setStartImageName(item.referenceImageName || String(itemSettings.referenceImageName || ""));
    setCustomSize(!matchingAspects.some((option: { w: number; h: number }) => option.w === Number(item.width) && option.h === Number(item.height)));
    if (vary) return Boolean(matchingProfile);
    const seedNote = itemSettings.seed && itemSettings.seed !== "Random" ? ` Seed ${itemSettings.seed} is fixed until you change it.` : "";
    const message = matchingProfile
      ? `Settings applied.${seedNote}`
      : `Settings applied. Its model isn’t installed, so the current model stays.${seedNote}`;
    toast(message, {
      duration: 8000,
      action: before ? { label: "Undo", onClick: () => restoreDraft(before) } : undefined
    });
    return Boolean(matchingProfile);
  }

  function applyLoras(item: GalleryItem) {
    const loras = normalizeLoras(item.settings?.loras);
    if (!loras.length) {
      showToast("This output has no LoRAs", "error");
      return;
    }
    setLoras(loras);
    showToast("LoRAs applied", "success");
  }

  function moveZen(direction: 1 | -1) {
    if (!doneGallery.length) return;
    const currentIndex = Math.max(0, doneGallery.findIndex((item: GalleryItem) => item.id === zenItem?.id));
    setZenSelectedId(doneGallery[(currentIndex + direction + doneGallery.length) % doneGallery.length].id);
  }

  /** What the viewer steps through: the gallery in the order it is laid out (main.tsx viewerGallery). */
  function viewerItems(): GalleryItem[] {
    return view.viewerGallery || visibleGallery.filter((item: GalleryItem) => item.status === "pending" || item.status === "done" || item.status === "error");
  }

  function moveViewer(direction: 1 | -1) {
    if (!active) return;
    const doneItems = viewerItems();
    const currentIndex = doneItems.findIndex((item: GalleryItem) => item.id === active.id);
    if (currentIndex < 0 || doneItems.length < 2) return;
    resetViewer();
    setActive(doneItems[(currentIndex + direction + doneItems.length) % doneItems.length]);
  }

  function goLatestZen() {
    const latest = doneGallery[0];
    if (latest) setZenSelectedId(latest.id);
  }

  function submitZenPrompt(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    // Cmd/Ctrl+Enter always generates, even with "Enter to generate" off.
    const modified = event.metaKey || event.ctrlKey;
    if (!prefs.enterToGenerate && !modified) return;
    // Enter that confirms an IME composition (Japanese, Chinese, Korean) is not a submit.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    // generate() explains itself when something is missing, instead of doing nothing.
    generate();
  }

  function startZenStripDrag(event: React.PointerEvent<HTMLDivElement>) {
    // Touch scrolls the strip natively, with momentum; a tap selects via onClick.
    if (!zenStripRef.current || event.pointerType === "touch") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    zenStripDragRef.current = { id: event.pointerId, x: event.clientX, scrollLeft: zenStripRef.current.scrollLeft, moved: false };
  }

  function dragZenStrip(event: React.PointerEvent<HTMLDivElement>) {
    const drag = zenStripDragRef.current;
    if (!drag || drag.id !== event.pointerId || !zenStripRef.current) return;
    if (Math.abs(event.clientX - drag.x) > 4) drag.moved = true;
    zenStripRef.current.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
  }

  function stopZenStripDrag(event: React.PointerEvent<HTMLDivElement>) {
    const drag = zenStripDragRef.current;
    if (drag?.id === event.pointerId) {
      if (!drag.moved) {
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-zen-id]") as HTMLElement | null;
        const itemId = target?.dataset.zenId;
        if (itemId) setZenSelectedId(itemId);
      }
      window.setTimeout(() => {
        zenStripDragRef.current = null;
      }, 0);
    }
  }

  function selectZenItem(itemId: string) {
    if (zenStripDragRef.current?.moved) return;
    setZenSelectedId(itemId);
  }

  /** The pan that keeps the point under the cursor still as the zoom changes. */
  function anchoredPan(nextZoom: number, clientX: number, clientY: number, element: HTMLElement) {
    if (nextZoom <= 1) return { x: 0, y: 0 };
    const geometry = measureViewer(element);
    if (!geometry) return viewerPan;
    const point = { x: clientX, y: clientY };
    return anchorPan(geometry, nextZoom, viewerZoom, viewerPan, point, point);
  }

  function zoomViewer(nextZoom: number, anchor?: { x: number; y: number; element: HTMLElement }) {
    // Three decimals, so a touchpad's small steps still add up.
    const clamped = Math.max(0.5, Math.min(6, Math.round(nextZoom * 1000) / 1000));
    if (anchor) setViewerPan(anchoredPan(clamped, anchor.x, anchor.y, anchor.element));
    else if (clamped <= 1) setViewerPan({ x: 0, y: 0 });
    setViewerZoom(clamped);
  }

  // Attached natively and non-passive (useWheelRef), so preventDefault holds
  // and Ctrl+wheel or a touchpad pinch never zooms the page as well.
  function wheelViewer(event: WheelEvent, element: HTMLElement) {
    if (active?.type === 'video') return;
    event.preventDefault();
    event.stopPropagation();
    const { y } = wheelPixels(event, element.clientHeight);
    if (y === 0) return;
    // Proportional to how far the wheel moved: a mouse notch (~100 px) is
    // about x1.16, a precision touchpad glides. Capped per event.
    const factor = Math.exp(Math.max(-0.35, Math.min(0.35, -y * 0.0015)));
    zoomViewer(viewerZoom * factor, { x: event.clientX, y: event.clientY, element });
  }

  function clickViewer(event: React.MouseEvent) {
    if ((event.target as Element).closest('[data-video-viewer]')) return;
    event.stopPropagation();
    if (Date.now() - viewerDragEndRef.current < 220) return;
    if (viewerDragRef.current?.moved) return;
    const canvas = event.currentTarget as HTMLElement;
    const media = canvas.querySelector("img, video") as HTMLImageElement | HTMLVideoElement | null;
    if (media && viewerZoom <= 1) {
      const rect = containedRect(media);
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) {
        setActive(null);
        return;
      }
    }
    // On touch a single tap only closes (outside the image); zoom is a double tap
    // or a pinch, so a stray tap never jumps the picture to 200%.
    if (Date.now() - lastTouchRef.current < 700) return;
    if (viewerZoom > 1) {
      zoomViewer(1);
    } else {
      zoomViewer(2);
    }
  }

  function startViewerDrag(event: React.PointerEvent) {
    if ((event.target as Element).closest('[data-video-viewer]')) return;
    if (event.pointerType === "touch") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    viewerDragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: viewerPan.x, panY: viewerPan.y, moved: false };
    setIsDraggingViewer(true);
  }

  function dragViewer(event: React.PointerEvent) {
    if (event.pointerType === "touch") return;
    const drag = viewerDragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    if (viewerZoom > 1) setViewerPan({ x: drag.panX + dx, y: drag.panY + dy });
  }

  function stopViewerDrag(event: React.PointerEvent) {
    if (event.pointerType === "touch") return;
    if (viewerDragRef.current?.id === event.pointerId) {
      const moved = viewerDragRef.current.moved;
      setIsDraggingViewer(false);
      if (moved) viewerDragEndRef.current = Date.now();
      window.setTimeout(() => { viewerDragRef.current = null; }, 0);
    }
  }

  // React listens to touchstart and touchmove passively, so preventDefault()
  // there does nothing but log a warning; touch-action: none on the stage is
  // what keeps the browser from scrolling or zooming the page meanwhile.
  // A gesture paints the canvas itself (viewerGesture.ts) and only tells React
  // where it came to rest, so a pinch never waits on the studio rendering.
  function viewerCanvas(event: React.TouchEvent) {
    return event.currentTarget as HTMLElement;
  }

  function beginPinch(canvas: HTMLElement, touches: React.TouchList, zoom: number, pan: Pan) {
    touchGestureRef.current = {
      mode: "pinch",
      geometry: measureViewer(canvas),
      distance: Math.max(1, touchDistance(touches)),
      zoom,
      pan,
      center: touchCenter(touches),
      last: touchCenter(touches),
      current: { zoom, pan },
      moved: false
    };
  }

  function beginPan(touch: React.Touch, zoom: number, pan: Pan, canvas: HTMLElement, moved = false) {
    const velocity = new Velocity();
    velocity.add(touch.clientX, touch.clientY);
    touchGestureRef.current = { mode: "pan", id: touch.identifier, x: touch.clientX, y: touch.clientY, zoom, pan, geometry: measureViewer(canvas), current: pan, velocity, moved };
  }

  function startViewerTouch(event: React.TouchEvent) {
    // A video swipes like a picture, except from its controls (the timeline
    // scrubs), and never pinches or pans: it has no zoom.
    const target = event.target as Element;
    if (target.closest('[data-video-viewer]') && (event.touches.length !== 1 || viewerZoom > 1 || target.closest('.heiss-video-controls, .heiss-video-error'))) return;
    const canvas = viewerCanvas(event);
    // The last swipe is still carrying its picture off: let it land first.
    if (canvas.dataset.settle === "slide") return;
    // Caught mid-spring, it carries on from where it is on screen.
    const live = liveTransform(canvas, { zoom: viewerZoom, pan: viewerPan });
    const gesture = touchGestureRef.current;
    const holding = gesture?.mode === "pinch" ? gesture.current : gesture?.mode === "pan" ? { zoom: gesture.zoom, pan: gesture.current } : null;
    const start = holding || live;
    paint(canvas, start.zoom, start.pan);
    if (event.touches.length >= 2) {
      beginPinch(canvas, event.touches, start.zoom, start.pan);
      return;
    }
    const touch = event.touches[0];
    if (start.zoom > MIN_ZOOM + 0.001) {
      beginPan(touch, start.zoom, start.pan, canvas);
      return;
    }
    // At fit size one finger swipes: sideways for the next image, down to close.
    const velocity = new Velocity();
    velocity.add(touch.clientX, touch.clientY);
    touchGestureRef.current = { mode: "swipe", id: touch.identifier, x: touch.clientX, y: touch.clientY, dx: 0, dy: 0, axis: null, velocity, moved: false };
  }

  function moveViewerTouch(event: React.TouchEvent) {
    const gesture = touchGestureRef.current;
    if (!gesture) return;
    const canvas = viewerCanvas(event);
    if (gesture.mode === "pinch" && event.touches.length >= 2) {
      if (!gesture.geometry) gesture.geometry = measureViewer(canvas);
      const geometry = gesture.geometry;
      if (!geometry) return;
      const distance = touchDistance(event.touches);
      const center = touchCenter(event.touches);
      if (Math.abs(distance - gesture.distance) > 4 || Math.hypot(center.x - gesture.center.x, center.y - gesture.center.y) > 4) gesture.moved = true;
      gesture.last = center;
      const zoom = rubberZoom(gesture.zoom * (distance / gesture.distance));
      const pan = rubberPan(geometry, zoom, anchorPan(geometry, zoom, gesture.zoom, gesture.pan, gesture.center, center));
      gesture.current = { zoom, pan };
      paint(canvas, zoom, pan);
      return;
    }
    if (gesture.mode === "swipe" && event.touches.length === 1) {
      const touch = event.touches[0];
      gesture.velocity.add(touch.clientX, touch.clientY);
      gesture.dx = touch.clientX - gesture.x;
      gesture.dy = touch.clientY - gesture.y;
      if (!gesture.axis && Math.hypot(gesture.dx, gesture.dy) > 8) {
        gesture.moved = true;
        // Decided once, so a sideways swipe that sags doesn't start closing.
        gesture.axis = Math.abs(gesture.dx) >= Math.abs(gesture.dy) ? "x" : "y";
      }
      if (gesture.axis === "x") {
        // Nothing to go to: it gives, but only a little.
        const x = viewerNeighbors() ? gesture.dx : rubber(gesture.dx, 0, 0, 80);
        paint(canvas, 1, { x, y: 0 });
      } else if (gesture.axis === "y") {
        paint(canvas, 1, { x: 0, y: active ? Math.max(0, gesture.dy) : rubber(gesture.dy, 0, 0, 80) });
      }
      return;
    }
    if (gesture.mode === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      gesture.velocity.add(touch.clientX, touch.clientY);
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) gesture.moved = true;
      const pan = rubberPan(gesture.geometry, gesture.zoom, { x: gesture.pan.x + dx, y: gesture.pan.y + dy });
      gesture.current = pan;
      paint(canvas, gesture.zoom, pan);
    }
  }

  /** Where the picture comes to rest, in state and on screen, sprung there unless it's already in place. */
  function settleViewer(canvas: HTMLElement, zoom: number, pan: Pan) {
    paint(canvas, zoom, pan, "settle");
    setViewerZoom(zoom);
    setViewerPan(pan);
  }

  function viewerNeighbors() {
    if (!active) return doneGallery.length > 1;
    return viewerItems().length > 1;
  }

  /** The next picture slides in from the side the finger was heading away from. */
  function swipeTo(canvas: HTMLElement, direction: 1 | -1) {
    const width = canvas.clientWidth || window.innerWidth;
    paint(canvas, 1, { x: -direction * width, y: 0 }, "slide");
    window.setTimeout(() => {
      // Rendered now, so the next picture is in place before it slides in.
      flushSync(() => {
        if (active) moveViewer(direction);
        else moveZen(direction);
      });
      requestAnimationFrame(() => {
        paint(canvas, 1, { x: direction * width * 0.35, y: 0 });
        void canvas.offsetWidth;
        settleViewer(canvas, 1, { x: 0, y: 0 });
      });
    }, 150);
  }

  function endViewerTouch(event: React.TouchEvent) {
    const gesture = touchGestureRef.current;
    lastTouchRef.current = Date.now();
    if (!gesture) return;
    const canvas = viewerCanvas(event);
    // One finger of a pinch lifts: the other carries on panning, no jump.
    if (event.touches.length >= 1) {
      if (gesture.mode === "pinch" && event.touches.length === 1) beginPan(event.touches[0], gesture.current.zoom, gesture.current.pan, canvas, true);
      else if (gesture.mode === "pinch" && event.touches.length >= 2) beginPinch(canvas, event.touches, gesture.current.zoom, gesture.current.pan);
      return;
    }
    touchGestureRef.current = null;
    if (gesture.moved) viewerDragEndRef.current = Date.now();

    if (gesture.mode === "swipe") {
      if (gesture.moved) {
        const { dx, dy } = gesture;
        const velocity = gesture.velocity.read();
        const width = canvas.clientWidth || window.innerWidth;
        // Far enough, or a quick flick the same way: a short fast swipe counts.
        if (gesture.axis === "x" && viewerNeighbors() && (Math.abs(dx) > width * 0.22 || (Math.abs(velocity.x) > 0.35 && Math.abs(dx) > 20 && Math.sign(velocity.x) === Math.sign(dx)))) {
          swipeTo(canvas, dx < 0 ? 1 : -1);
          return;
        }
        if (gesture.axis === "y" && active && (dy > 110 || (velocity.y > 0.45 && dy > 30))) {
          setActive(null);
          return;
        }
        settleViewer(canvas, 1, { x: 0, y: 0 });
        return;
      }
      // A tap, or the second of a double tap: zoom in on the spot tapped.
      const touch = event.changedTouches[0];
      const nowTap = Date.now();
      if (touch && nowTap - lastTapRef.current < 280) {
        event.preventDefault();
        lastTapRef.current = 0;
        const geometry = measureViewer(canvas);
        const zoom = 2.5;
        const point = { x: touch.clientX, y: touch.clientY };
        const pan = geometry ? clampPan(geometry, zoom, anchorPan(geometry, zoom, 1, { x: 0, y: 0 }, point, point)) : { x: 0, y: 0 };
        settleViewer(canvas, zoom, pan);
        return;
      }
      lastTapRef.current = nowTap;
      paint(canvas, 1, { x: 0, y: 0 }, "settle");
      return;
    }

    if (gesture.mode === "pan") {
      if (!gesture.moved) {
        const nowTap = Date.now();
        if (nowTap - lastTapRef.current < 280) {
          event.preventDefault();
          lastTapRef.current = 0;
          settleViewer(canvas, 1, { x: 0, y: 0 });
          return;
        }
        lastTapRef.current = nowTap;
      }
      // Let go moving, it glides on a little before it stops, kept in view.
      const velocity = gesture.velocity.read();
      const glide = { x: gesture.current.x + velocity.x * 220, y: gesture.current.y + velocity.y * 220 };
      settleViewer(canvas, gesture.zoom, clampPan(gesture.geometry, gesture.zoom, glide));
      return;
    }

    // A pinch ends: too small springs back to fit, too large back to the most
    // there is, about the fingers, and either way the picture stays in view.
    const geometry = gesture.geometry || measureViewer(canvas);
    const raw = gesture.current.zoom;
    const zoom = raw < 1.05 ? MIN_ZOOM : Math.min(MAX_ZOOM, raw);
    if (zoom === MIN_ZOOM || !geometry) {
      settleViewer(canvas, zoom, { x: 0, y: 0 });
      return;
    }
    const pan = zoom === raw ? gesture.current.pan : anchorPan(geometry, zoom, raw, gesture.current.pan, gesture.last, gesture.last);
    settleViewer(canvas, zoom, clampPan(geometry, zoom, pan));
  }
  return { resetViewer, openItem, applyAllSettings, applyLoras, moveZen, moveViewer, goLatestZen, submitZenPrompt, startZenStripDrag, dragZenStrip, stopZenStripDrag, selectZenItem, zoomViewer, wheelViewer, clickViewer, startViewerDrag, dragViewer, stopViewerDrag, startViewerTouch, moveViewerTouch, endViewerTouch };
}
