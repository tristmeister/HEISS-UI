/**
 * Hiding is a move, so it looks like one, briefly: the picture lifts off its
 * tile, shrinks into Hidden's button in the dock, and the button nods as it
 * lands. Moving back out plays the same into the Hidden bar's back button.
 */

const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export async function flyInto(from: DOMRect, target: Element | null, src: string | undefined, { delay = 0 } = {}) {
  if (!target || !src || reduceMotion()) {
    pulse(target);
    return;
  }
  const to = target.getBoundingClientRect();
  const ghost = document.createElement('div');
  ghost.style.cssText = `position:fixed;left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;z-index:120;pointer-events:none;border-radius:14px;overflow:hidden;transform-origin:center;will-change:transform,opacity;background:center/cover no-repeat url("${src.replace(/"/g, '\\"')}");`;
  document.body.appendChild(ghost);

  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const end = Math.max(0.04, Math.min(to.width, to.height) / Math.max(from.width, from.height));
  const flight = ghost.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1, borderRadius: '14px', boxShadow: '0 0 0 rgb(0 0 0 / 0)' },
    { transform: `translate(${dx * 0.06}px,${dy * 0.06 - 8}px) scale(.94)`, opacity: 1, borderRadius: '16px', boxShadow: '0 14px 36px rgb(0 0 0 / .45)', offset: 0.2 },
    { transform: `translate(${dx}px,${dy}px) scale(${end})`, opacity: 0, borderRadius: '50%', boxShadow: '0 0 0 rgb(0 0 0 / 0)' }
  ], { duration: 460, delay: Math.min(delay, 240), easing: 'cubic-bezier(.5,0,.2,1)', fill: 'forwards' });
  try { await flight.finished; } catch { /* interrupted */ }
  ghost.remove();
  pulse(target);
}

export function pulse(target: Element | null) {
  if (!target) return;
  target.classList.remove('is-catching');
  // Restart the animation even if the last catch is still playing.
  void (target as HTMLElement).offsetWidth;
  target.classList.add('is-catching');
  window.setTimeout(() => target.classList.remove('is-catching'), 400);
}

export const hiddenDockTarget = () => document.querySelector('[data-hidden-dock]');
