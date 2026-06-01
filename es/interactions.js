// interactions.js — press feedback for [data-interaction="press"] buttons.
// Keyboard parity: Enter/Space get the same scale animation as mouse/touch.

const PRESS_SCALE = 'scale(0.97)';
const RELEASE_MS = 200;
const EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

function isReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function pressDown(el) {
  if (el.getAttribute('aria-disabled') === 'true') return;
  if (isReducedMotion()) return;
  el.style.transition = `transform 100ms ${EASING}`;
  el.style.transform = PRESS_SCALE;
}

function pressUp(el) {
  el.style.transition = `transform ${RELEASE_MS}ms ${EASING}`;
  el.style.transform = '';
}

export function init() {
  document.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-interaction="press"]');
    if (btn) pressDown(btn);
  });

  document.addEventListener('mouseup', () => {
    const active = document.querySelector('[data-interaction="press"][style*="scale"]');
    if (active) pressUp(active);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const btn = e.target.closest('[data-interaction="press"]');
    if (!btn) return;
    if (e.key === ' ') e.preventDefault(); // prevent scroll
    pressDown(btn);
  });

  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const btn = e.target.closest('[data-interaction="press"]');
    if (btn) pressUp(btn);
  });
}
