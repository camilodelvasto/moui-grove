// a11y.js — Focus management, live regions, skip links.

let liveRegion = null;

export function init() {
  liveRegion = document.createElement('div');
  liveRegion.setAttribute('role', 'status');
  liveRegion.setAttribute('aria-live', 'polite');
  liveRegion.setAttribute('aria-atomic', 'true');
  liveRegion.className = 'sr-only';
  document.body.appendChild(liveRegion);
}

export function focusMain() {
  const main = document.getElementById('main');
  if (!main) return;
  main.setAttribute('tabindex', '-1');
  main.focus({ preventScroll: true });
  main.addEventListener('blur', function handler() {
    main.removeAttribute('tabindex');
    main.removeEventListener('blur', handler);
  });
}

export function announce(message) {
  if (!liveRegion) return;
  liveRegion.textContent = message;
  setTimeout(() => { liveRegion.textContent = ''; }, 1000);
}

export function trapFocus(element) {
  const focusable = element.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), ' +
    'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return () => {};

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const previousFocus = document.activeElement;

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      release();
      return;
    }
    if (e.key !== 'Tab') return;
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  element.addEventListener('keydown', handleKeydown);
  first.focus();

  function release() {
    element.removeEventListener('keydown', handleKeydown);
    if (previousFocus && previousFocus.focus) {
      previousFocus.focus();
    }
  }

  return release;
}
