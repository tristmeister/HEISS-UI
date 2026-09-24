/**
 * Hiding is a move, so it looks like one: the picture lifts off its tile,
 * breaks into the same pixel mosaic generations resolve from, and drops into
 * Hidden's button in the dock, which catches it with a pulse. Unhiding plays
 * it from wherever the picture is going.
 */

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A coarse copy of the picture: the mosaic it breaks into mid-flight. */
function mosaicOf(src: string, cells = 10): Promise<string> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        const ratio = image.naturalWidth / Math.max(1, image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round(ratio >= 1 ? cells : cells * ratio));
        canvas.height = Math.max(2, Math.round(ratio >= 1 ? cells / ratio : cells));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL());
      } catch {
        resolve('');
      }
    };
    image.onerror = () => resolve('');
    image.src = src;
  });
}

function layer(src: string, pixelated = false) {
  const element = document.createElement('div');
  element.style.cssText = `position:absolute;inset:0;background:center/cover no-repeat url("${src.replace(/"/g, '\\"')}");${pixelated ? 'image-rendering:pixelated;' : ''}`;
  return element;
}

export async function flyInto(from: DOMRect, target: Element | null, src: string | undefined, { delay = 0 } = {}) {
  if (!target || !src || reduceMotion()) {
    pulse(target);
    return;
  }
  const to = target.getBoundingClientRect();
  const mosaic = await mosaicOf(src);
  const ghost = document.createElement('div');
  ghost.className = 'hidden-flight';
  ghost.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;z-index:120;pointer-events:none;border-radius:14px;overflow:hidden;transform-origin:center;will-change:transform,opacity;`;
  const clear = layer(src);
  ghost.appendChild(clear);
  const coarse = mosaic ? layer(mosaic, true) : null;
  if (coarse) { coarse.style.opacity = '0'; ghost.appendChild(coarse); }
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const end = Math.max(0.04, Math.min(to.width, to.height) / Math.max(from.width, from.height));
  const duration = 720;
  const easing = 'cubic-bezier(.55,0,.25,1)';
  const flight = ghost.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '14px', boxShadow: '0 0 0 rgb(255 154 82 / 0)' },
    { transform: `translate(${dx * 0.08}px,${dy * 0.08 - 14}px) scale(.92)`, opacity: 1, borderRadius: '16px', boxShadow: '0 18px 50px rgb(0 0 0 / .55), 0 0 28px rgb(255 154 82 / .35)', offset: 0.22 },
    { transform: `translate(${dx}px,${dy}px) scale(${end})`, opacity: 0.35, borderRadius: '50%', boxShadow: '0 0 18px rgb(255 154 82 / .8)' }
  ], { duration, delay, easing, fill: 'forwards' });
  coarse?.animate([{ opacity: 0 }, { opacity: 0, offset: 0.25 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], { duration, delay, easing: 'linear', fill: 'forwards' });
  try { await flight.finished; } catch { /* interrupted */ }
  ghost.remove();
  pulse(target);
}

/** Reverse flight: a picture leaving Hidden, out of `source`, toward where it is going. */
export async function flyOut(source: Element | null, to: DOMRect, src: string | undefined) {
  if (!source || !src || reduceMotion()) return;
  const from = source.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:fixed;left:${to.left}px;top:${to.top}px;width:${to.width}px;height:${to.height}px;z-index:120;pointer-events:none;border-radius:14px;overflow:hidden;`;
  ghost.appendChild(layer(src));
  document.body.appendChild(ghost);
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  const start = Math.max(0.04, Math.min(from.width, from.height) / Math.max(to.width, to.height));
  const flight = ghost.animate([
    { transform: `translate(${dx}px,${dy}px) scale(${start})`, opacity: 0.2, borderRadius: '50%' },
    { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '14px' }
  ], { duration: 560, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  try { await flight.finished; } catch { /* interrupted */ }
  ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, fill: 'forwards' }).finished.finally(() => ghost.remove());
}

export function pulse(target: Element | null) {
  if (!target) return;
  target.classList.remove('is-catching');
  // Restart the animation even if the last catch is still playing.
  void (target as HTMLElement).offsetWidth;
  target.classList.add('is-catching');
  window.setTimeout(() => target.classList.remove('is-catching'), 700);
}

export const hiddenDockTarget = () => document.querySelector('[data-hidden-dock]');
