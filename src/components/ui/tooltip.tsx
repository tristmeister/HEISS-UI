"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";

// ---------------------------------------------------------------------------
// Timing: the single source of truth for every tooltip in the app
// ---------------------------------------------------------------------------

/** Rest this long on a control before its tooltip shows. */
const TOOLTIP_DELAY = 600;
/**
 * After a tooltip closes, the next one within this window opens at once, so
 * sweeping across a toolbar reads label after label without waiting each time.
 */
const TOOLTIP_SKIP_DELAY = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TooltipSide = "top" | "right" | "bottom" | "left";

interface TooltipProps {
  content: ReactNode;
  children: React.ReactElement;
  side?: TooltipSide;
  sideOffset?: number;
  className?: string;
  /** When true, forces the tooltip open. When false, forces it closed. When undefined, uses default hover/focus behavior. */
  forceOpen?: boolean;
  /** Called when the tooltip's internal open state changes (before forceOpen is applied). */
  onOpenChange?: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const ProvidedContext = createContext(false);

/**
 * Mount once at the app root. One shared provider is what lets Radix carry
 * the "already showing tooltips" state from one trigger to its neighbour.
 */
function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={TOOLTIP_DELAY} skipDelayDuration={TOOLTIP_SKIP_DELAY} disableHoverableContent>
      <ProvidedContext.Provider value>{children}</ProvidedContext.Provider>
    </TooltipPrimitive.Provider>
  );
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

function getSlideOffset(side: TooltipSide) {
  switch (side) {
    case "top":
      return { y: 4 };
    case "bottom":
      return { y: -4 };
    case "left":
      return { x: 4 };
    case "right":
      return { x: -4 };
  }
}

function getTransformOrigin(side: TooltipSide) {
  switch (side) {
    case "top":
      return "bottom center";
    case "bottom":
      return "top center";
    case "left":
      return "right center";
    case "right":
      return "left center";
  }
}

/** Keyboard focus only: a click, a tap or focus handed back by a closing menu shouldn't pop a label. */
function isFocusVisible(target: EventTarget) {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/*
 * Hover opens only for a mouse or pen (Radix ignores touch pointers), so a
 * tap on a phone never flashes a label. On top of Radix's own dismissal
 * (click, blur, Escape, scrolling while open) a press hides the tooltip even
 * when the trigger swallows pointerdown or the delay is still running, and it
 * stays hidden until the pointer leaves.
 */
function Tooltip(props: TooltipProps) {
  const provided = useContext(ProvidedContext);
  // Safety net for a tooltip rendered outside the app root (a test, a stray
  // portal root): Radix throws without a provider, so lend it the same one.
  if (!provided) return <TooltipProvider><TooltipInner {...props} /></TooltipProvider>;
  return <TooltipInner {...props} />;
}

function TooltipInner({
  content,
  children,
  side = "top",
  sideOffset = 8,
  className,
  forceOpen,
  onOpenChange: onOpenChangeProp,
}: TooltipProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [pressed, setPressed] = useState(false);
  const open = forceOpen !== undefined ? forceOpen : internalOpen && !pressed;
  const [mounted, setMounted] = useState(false);
  const shape = useShape();
  const reducedMotion = useReducedMotion();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const stopWatchingScroll = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const handleExitComplete = () => {
    if (!open) setMounted(false);
  };

  // Radix only closes on scroll once the tooltip shows; this also catches a
  // scroll during the delay, so a label never lands on content that moved.
  const watchScroll = useCallback(() => {
    if (stopWatchingScroll.current) return;
    const onScroll = (event: Event) => {
      const trigger = triggerRef.current;
      if (trigger && event.target instanceof Node && event.target.contains(trigger)) setPressed(true);
    };
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    stopWatchingScroll.current = () => window.removeEventListener("scroll", onScroll, { capture: true });
  }, []);

  const release = useCallback(() => {
    stopWatchingScroll.current?.();
    stopWatchingScroll.current = null;
    setPressed(false);
  }, []);

  useEffect(() => () => stopWatchingScroll.current?.(), []);

  const slideOffset = getSlideOffset(side);

  return (
    <TooltipPrimitive.Root
      open={forceOpen !== undefined ? forceOpen : internalOpen}
      onOpenChange={(value) => {
        setInternalOpen(value);
        if (!value) setPressed(false);
        onOpenChangeProp?.(value);
      }}
    >
      <TooltipPrimitive.Trigger
        asChild
        ref={triggerRef}
        // Capture phase: runs before the child's own handler can preventDefault
        // and keep Radix from seeing the press (the number steppers do).
        onPointerDownCapture={() => setPressed(true)}
        onPointerEnter={watchScroll}
        onPointerLeave={release}
        onFocus={(event) => {
          // A prevented focus event skips Radix's open handler.
          if (!isFocusVisible(event.target)) event.preventDefault();
        }}
        onBlur={release}
      >
        {children}
      </TooltipPrimitive.Trigger>
      {mounted && (
        <TooltipPrimitive.Portal forceMount>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={sideOffset}
            collisionPadding={8}
            forceMount
            style={{ pointerEvents: "none", zIndex: "var(--z-tooltip)" as unknown as number }}
          >
            <motion.div
              className={cn(
                "bg-foreground text-background text-[12px] px-2 py-1",
                shape.bg,
                className
              )}
              style={{ fontVariationSettings: fontWeights.medium, transformOrigin: getTransformOrigin(side) }}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, filter: "blur(3px)", ...slideOffset }}
              animate={reducedMotion ? { opacity: open ? 1 : 0 } : {
                opacity: open ? 1 : 0,
                scale: open ? 1 : 0.96,
                filter: open ? "blur(0px)" : "blur(3px)",
                x: 0,
                y: 0,
              }}
              transition={reducedMotion ? { duration: open ? 0.1 : 0.08 } : open ? { type: "spring", duration: 0.26, bounce: 0 } : { duration: 0.12 }}
              onAnimationComplete={handleExitComplete}
            >
              {content}
            </motion.div>
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </TooltipPrimitive.Root>
  );
}

export { Tooltip, TooltipProvider };
export type { TooltipProps, TooltipSide };
