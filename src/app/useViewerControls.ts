import { fallbackAspectPresets } from './constants';
import { clampText, settingMax } from './format';
import { touchCenter, touchDistance } from './gallery';
import { normalizeLoras } from './loras';
import type React from 'react';
import { toast } from 'sonner';
import { wheelPixels } from './wheel';
import type { GalleryItem, Profile } from './types';

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
    setZenSelectedId, showToast, touchGestureRef, viewerDragEndRef, viewerDragRef, viewerPan,
    viewerZoom, visibleGallery, width, zenItem, zenStripDragRef, zenStripRef
  } = view;
  const lastTouchRef = view.lastTouchRef as React.MutableRefObject<number>;
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

  function applyAllSettings(item: GalleryItem) {
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
    if (itemSettings.seed && itemSettings.seed !== "Random") setSeed(String(itemSettings.seed));
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
    const seedNote = itemSettings.seed && itemSettings.seed !== "Random" ? ` Seed ${itemSettings.seed} is fixed until you change it.` : "";
    const message = matchingProfile
      ? `Settings applied.${seedNote}`
      : `Settings applied, but its workflow isn’t installed, so the current one stays.${seedNote}`;
    toast(message, {
      duration: 8000,
      action: before ? { label: "Undo", onClick: () => restoreDraft(before) } : undefined
    });
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

  function moveViewer(direction: 1 | -1) {
    if (!active) return;
    const doneItems = visibleGallery.filter((item: GalleryItem) => item.status === "pending" || item.status === "done" || item.status === "error");
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

  function anchoredPan(nextZoom: number, clientX: number, clientY: number, element: HTMLElement) {
    if (nextZoom <= 1) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    const anchorX = clientX - rect.left - rect.width / 2;
    const anchorY = clientY - rect.top - rect.height / 2;
    const scale = nextZoom / Math.max(viewerZoom, 0.01);
    return {
      x: anchorX - (anchorX - viewerPan.x) * scale,
      y: anchorY - (anchorY - viewerPan.y) * scale
    };
  }

  function anchoredPanFromStart(nextZoom: number, clientX: number, clientY: number, element: HTMLElement, startZoom: number, startPan: { x: number; y: number }) {
    if (nextZoom <= 1) return { x: 0, y: 0 };
    const rect = element.getBoundingClientRect();
    const anchorX = clientX - rect.left - rect.width / 2;
    const anchorY = clientY - rect.top - rect.height / 2;
    const scale = nextZoom / Math.max(startZoom, 0.01);
    return {
      x: anchorX - (anchorX - startPan.x) * scale,
      y: anchorY - (anchorY - startPan.y) * scale
    };
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
  function startViewerTouch(event: React.TouchEvent) {
    if (event.touches.length === 2) {
      const center = touchCenter(event.touches);
      touchGestureRef.current = {
        mode: "pinch",
        distance: touchDistance(event.touches),
        zoom: viewerZoom,
        panX: viewerPan.x,
        panY: viewerPan.y,
        centerX: center.x,
        centerY: center.y,
        moved: false
      };
      setIsDraggingViewer(true);
      return;
    }
    if (event.touches.length === 1 && viewerZoom <= 1) {
      // At fit size one finger swipes: sideways for the next image, down to close.
      const touch = event.touches[0];
      touchGestureRef.current = { mode: "swipe", id: touch.identifier, x: touch.clientX, y: touch.clientY, dx: 0, dy: 0, moved: false };
      return;
    }
    if (event.touches.length === 1 && viewerZoom > 1) {
      const touch = event.touches[0];
      touchGestureRef.current = {
        mode: "pan",
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
        panX: viewerPan.x,
        panY: viewerPan.y,
        moved: false
      };
      setIsDraggingViewer(true);
    }
  }

  function moveViewerTouch(event: React.TouchEvent) {
    const gesture = touchGestureRef.current;
    if (!gesture) return;
    if (gesture.mode === "pinch" && event.touches.length >= 2) {
      const distance = touchDistance(event.touches);
      const center = touchCenter(event.touches);
      const nextZoom = Math.max(0.5, Math.min(6, Number((gesture.zoom * (distance / gesture.distance)).toFixed(2))));
      if (Math.abs(distance - gesture.distance) > 4) gesture.moved = true;
      setViewerZoom(nextZoom);
      setViewerPan(anchoredPanFromStart(nextZoom, center.x, center.y, event.currentTarget as HTMLElement, gesture.zoom, { x: gesture.panX, y: gesture.panY }));
      return;
    }
    if (gesture.mode === "swipe" && event.touches.length === 1) {
      const touch = event.touches[0];
      gesture.dx = touch.clientX - gesture.x;
      gesture.dy = touch.clientY - gesture.y;
      if (Math.abs(gesture.dx) > 8 || Math.abs(gesture.dy) > 8) gesture.moved = true;
      // The image follows the finger: sideways freely, vertically only downward.
      if (gesture.moved) setViewerPan(Math.abs(gesture.dx) > Math.abs(gesture.dy) ? { x: gesture.dx, y: 0 } : { x: 0, y: Math.max(0, gesture.dy) });
      return;
    }
    if (gesture.mode === "pan" && event.touches.length === 1) {
      const touch = event.touches[0];
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) gesture.moved = true;
      setViewerPan({ x: gesture.panX + dx, y: gesture.panY + dy });
    }
  }

  function endViewerTouch(event: React.TouchEvent) {
    const gesture = touchGestureRef.current;
    lastTouchRef.current = Date.now();
    setIsDraggingViewer(false);
    if (gesture?.mode === "swipe" && gesture.moved) {
      touchGestureRef.current = null;
      viewerDragEndRef.current = Date.now();
      const { dx, dy } = gesture;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        setViewerPan({ x: 0, y: 0 });
        // The same gesture steps through zen's stage when no viewer is open.
        if (active) moveViewer(dx < 0 ? 1 : -1);
        else moveZen(dx < 0 ? 1 : -1);
        return;
      }
      if (active && dy > 90 && dy > Math.abs(dx) * 1.4) {
        setActive(null);
        return;
      }
      setViewerPan({ x: 0, y: 0 });
      return;
    }
    const tapped = !gesture || (gesture.mode === "swipe" && !gesture.moved);
    if (gesture?.moved) {
      viewerDragEndRef.current = Date.now();
    } else if (tapped && event.changedTouches.length === 1) {
      const nowTap = Date.now();
      if (nowTap - lastTapRef.current < 280) {
        event.preventDefault();
        zoomViewer(viewerZoom > 1 ? 1 : 2.5);
        lastTapRef.current = 0;
        return;
      }
      lastTapRef.current = nowTap;
    }
    if (viewerZoom <= 1) setViewerPan({ x: 0, y: 0 });
    touchGestureRef.current = null;
  }
  return { resetViewer, openItem, applyAllSettings, applyLoras, moveZen, moveViewer, goLatestZen, submitZenPrompt, startZenStripDrag, dragZenStrip, stopZenStripDrag, selectZenItem, zoomViewer, wheelViewer, clickViewer, startViewerDrag, dragViewer, stopViewerDrag, startViewerTouch, moveViewerTouch, endViewerTouch };
}
