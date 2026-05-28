// app.js — boot, navigation, sidebar, SSE live reload

import { renderSlide } from './renderer.js?v=1779983570';
import { applyCSSVariables } from './theme.js?v=1779983570';
import { mountWhiteboard, unmountWhiteboard, setWhiteboardSlide } from './whiteboard.js?v=1779983570';
import { parseHash, buildHash } from './hash-params.js?v=1779983570';

function base64urlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}

const state = { currentSlide: 0, slides: [], theme: {}, deckReveal: undefined, sidebarOpen: false, whiteboardActive: false };

// ── Edge zone constants ──────────────────────────────────────────────────────
// Duplicated in whiteboard.js — whiteboard.js must stay standalone for extraction.
// Keep in sync manually or extract to a shared platform constants module when
// a third consumer appears (rule of three).
const TAP_MAX_DURATION_MS = 300;
const TAP_MAX_MOVEMENT_PX = 10;
const EDGE_ZONE_PX = 48;

let leftEdge = null;
let rightEdge = null;

function flashEdge(direction) {
  const el = direction === 'prev' ? leftEdge : rightEdge;
  if (!el) return;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 250);
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

async function loadData() {
  const [contentRes, themeRes] = await Promise.all([fetch('./content.json'), fetch('./theme/tokens.json')]);
  const content = await contentRes.json();
  const theme = await themeRes.json();
  // Content-level theme overrides — tokens like font-base can be tweaked per-deck
  if (content.theme_overrides) {
    for (const [key, value] of Object.entries(content.theme_overrides)) {
      theme[key] = value;
    }
  }
  return { content, theme };
}

// ---------------------------------------------------------------------------
// Decryption
// ---------------------------------------------------------------------------

import { decryptContent } from './decrypt-runtime.js?v=1779983570';
import { resolveEncryptedMedia } from './asset-decrypt.js?v=1779983570';

function promptAndDecrypt(envelope, title) {
  return new Promise((resolve) => {
    const viewport = document.querySelector('.viewport');
    viewport.replaceChildren();

    const gate = document.createElement('div');
    gate.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:1rem;box-sizing:border-box;gap:1rem;font-family:system-ui,-apple-system,sans-serif;';

    const h = document.createElement('h1');
    h.textContent = title || 'Protected deck';
    h.style.cssText = 'font-size:1.25rem;font-weight:600;margin:0;color:#111;text-align:center;';
    gate.appendChild(h);

    const subtitle = document.createElement('p');
    subtitle.textContent = 'Enter the access code to view this presentation.';
    subtitle.style.cssText = 'font-size:0.875rem;font-weight:400;margin:0;color:#6b7280;text-align:center;max-width:20rem;line-height:1.4;';
    gate.appendChild(subtitle);

    const form = document.createElement('form');
    form.style.cssText = 'display:flex;flex-direction:column;gap:1rem;width:100%;max-width:20rem;align-items:stretch;margin-top:0.5rem;';
    form.autocomplete = 'off';

    const input = document.createElement('input');
    input.type = 'password';
    input.name = 'password';
    input.autocomplete = 'current-password';
    input.placeholder = 'access code';
    input.style.cssText = 'padding:0.75rem 1rem;font-size:1rem;font-family:inherit;border:2px solid #e5e7eb;border-radius:5px;background:#fff;color:#111;box-sizing:border-box;transition:border-color 0.2s ease-in-out;';
    input.addEventListener('focus', () => { input.style.borderColor = '#111'; input.style.outline = 'none'; });
    input.addEventListener('blur', () => { input.style.borderColor = '#e5e7eb'; });
    form.appendChild(input);

    const btn = document.createElement('button');
    btn.type = 'submit';
    btn.textContent = 'Unlock';
    btn.style.cssText = 'padding:0.75rem 1rem;font-size:0.95rem;font-weight:500;font-family:inherit;border-radius:5px;border:none;background:#111;color:#fff;cursor:pointer;transition:background-color 0.15s ease-in-out;';
    btn.addEventListener('mouseenter', () => { btn.style.background = '#333'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#111'; });
    form.appendChild(btn);

    const error = document.createElement('p');
    error.style.cssText = 'margin:0;color:#dc2626;font-size:0.85rem;min-height:1.1em;text-align:center;visibility:hidden;';
    error.textContent = '\u00A0';
    form.appendChild(error);

    gate.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      error.style.visibility = 'hidden';
      const mnemonic = input.value.trim();
      if (!mnemonic) return;

      try {
        const raw = await decryptContent(envelope, mnemonic);
        resolve({ content: JSON.parse(raw), mnemonic });
      } catch (err) {
        error.textContent = 'Wrong access code — try again';
        error.style.visibility = 'visible';
        input.value = '';
        input.focus();
      }
    });

    viewport.appendChild(gate);
    input.focus();
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const slide = state.slides[state.currentSlide];
  if (!slide) return;
  const viewport = document.querySelector('.viewport');
  renderSlide(slide, state.theme, viewport, state.deckReveal);
  updateCounter();
  updateHash();
  updateSidebarCurrent();
}

function updateCounter() {
  let counter = document.querySelector('.slide-counter');
  if (!counter) {
    counter = document.createElement('div');
    counter.className = 'slide-counter';
    document.body.appendChild(counter);
  }
  counter.textContent = `${state.currentSlide + 1} / ${state.slides.length}`;
}

function updateHash() {
  const n = state.currentSlide + 1;
  const hash = buildHash({ slide: String(n) });
  if (location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

function restoreFromHash() {
  const params = parseHash(location.hash);
  const n = parseInt(params.slide, 10);
  if (n >= 1 && n <= state.slides.length) {
    state.currentSlide = n - 1;
  }
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function goTo(index) {
  if (index < 0 || index >= state.slides.length) return;
  if (index === state.currentSlide) return;
  state.currentSlide = index;
  render();
  if (state.whiteboardActive) {
    setWhiteboardSlide(String(index));
  }
}

// ---------------------------------------------------------------------------
// Event bus — all input sources emit events, never call goTo/prev/next directly
// In Tauri, shell-tauri/ipc.js replaces these listeners with kernel invocations
// ---------------------------------------------------------------------------

window.addEventListener('moui:navigate', (e) => {
  const { direction, index } = e.detail;
  if (direction === 'prev') goTo(state.currentSlide - 1);
  else if (direction === 'next') goTo(state.currentSlide + 1);
  else if (index === -1) goTo(state.slides.length - 1);
  else if (index != null) goTo(index);
});

window.addEventListener('moui:sidebar', (e) => {
  const { action } = e.detail;
  if (action === 'toggle') toggleSidebar();
  else if (action === 'close') toggleSidebar(false);
});

// ── Input: Keyboard ──────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;

  switch (e.key) {
    case 'ArrowLeft': case 'ArrowUp':
      window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'prev' } }));
      break;
    case 'ArrowRight': case 'ArrowDown':
      window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'next' } }));
      break;
    case 'Home':
      window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { index: 0 } }));
      break;
    case 'End':
      window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { index: -1 } }));
      break;
    case 't':
      window.dispatchEvent(new CustomEvent('moui:sidebar', { detail: { action: 'toggle' } }));
      break;
    case 'f':
      window.dispatchEvent(new CustomEvent('moui:fullscreen', { detail: { action: 'toggle' } }));
      break;
    case 'Escape':
      window.dispatchEvent(new CustomEvent('moui:sidebar', { detail: { action: 'close' } }));
      break;
    default:
      if (e.key >= '1' && e.key <= '9') {
        window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { index: parseInt(e.key, 10) - 1 } }));
      }
  }
});

// ── Input: Touch ─────────────────────────────────────────────────────────────

let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', (e) => {
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (state.whiteboardActive) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
  if (dx < 0) {
    window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'next' } }));
  } else {
    window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'prev' } }));
  }
}, { passive: true });

// ── Input: Pointer (edge zone taps — always active) ──────────────────────────

let pointerDownX = 0;
let pointerDownY = 0;
let pointerDownTime = 0;

document.addEventListener('pointerdown', (e) => {
  pointerDownX = e.clientX;
  pointerDownY = e.clientY;
  pointerDownTime = performance.now();
});

let lastEdgeTapTime = 0;

document.addEventListener('pointerup', (e) => {
  // Ignore taps on interactive UI (buttons, inputs, links)
  const tag = e.target.tagName;
  if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'A' || e.target.closest('button, a, input')) return;

  const now = performance.now();
  const elapsed = now - pointerDownTime;
  const dx = Math.abs(e.clientX - pointerDownX);
  const dy = Math.abs(e.clientY - pointerDownY);
  if (elapsed >= TAP_MAX_DURATION_MS || dx >= TAP_MAX_MOVEMENT_PX || dy >= TAP_MAX_MOVEMENT_PX) return;

  // Debounce: touch devices fire pointer events for both touch and compat mouse
  if (now - lastEdgeTapTime < 400) return;

  const x = e.clientX;
  if (x <= EDGE_ZONE_PX) {
    lastEdgeTapTime = now;
    flashEdge('prev');
    window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'prev' } }));
  } else if (x >= window.innerWidth - EDGE_ZONE_PX) {
    lastEdgeTapTime = now;
    flashEdge('next');
    window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: 'next' } }));
  }
});

// Hash change
window.addEventListener('hashchange', () => {
  restoreFromHash();
  render();
});

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function buildSidebar() {
  const sidebar = document.createElement('nav');
  sidebar.className = 'sidebar';

  const search = document.createElement('input');
  search.className = 'sidebar-search';
  search.type = 'search';
  search.placeholder = 'Search slides...';
  search.autocomplete = 'off';
  sidebar.appendChild(search);

  const list = document.createElement('ul');
  list.className = 'sidebar-list';
  sidebar.appendChild(list);

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  backdrop.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('moui:sidebar', { detail: { action: 'close' } }));
  });

  document.body.appendChild(backdrop);
  document.body.appendChild(sidebar);

  buildSidebarItems(list, '');

  search.addEventListener('input', () => {
    buildSidebarItems(list, search.value.toLowerCase());
  });

  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = list.querySelector('li');
      if (first) first.focus();
    }
  });
}

function buildSidebarItems(list, filter) {
  list.innerHTML = '';
  state.slides.forEach((slide, i) => {
    const title = slide.content?.heading || slide.id || `Slide ${i + 1}`;
    if (filter && !title.toLowerCase().includes(filter)) return;

    const li = document.createElement('li');
    li.tabIndex = 0;
    if (i === state.currentSlide) li.classList.add('current');

    const num = document.createElement('span');
    num.className = 'slide-num';
    num.textContent = i + 1;
    li.appendChild(num);
    li.appendChild(document.createTextNode(title));

    li.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { index: i } }));
      window.dispatchEvent(new CustomEvent('moui:sidebar', { detail: { action: 'close' } }));
    });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { index: i } }));
        window.dispatchEvent(new CustomEvent('moui:sidebar', { detail: { action: 'close' } }));
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); li.nextElementSibling?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); li.previousElementSibling?.focus(); }
    });

    list.appendChild(li);
  });
}

function toggleSidebar(force) {
  state.sidebarOpen = force !== undefined ? force : !state.sidebarOpen;
  document.querySelector('.sidebar')?.classList.toggle('open', state.sidebarOpen);
  document.querySelector('.sidebar-backdrop')?.classList.toggle('open', state.sidebarOpen);
  if (leftEdge) leftEdge.style.opacity = state.sidebarOpen ? '0' : '1';
  if (state.sidebarOpen) {
    const search = document.querySelector('.sidebar-search');
    if (search) { search.value = ''; search.focus(); }
    buildSidebarItems(document.querySelector('.sidebar-list'), '');
  }
}

function updateSidebarCurrent() {
  const items = document.querySelectorAll('.sidebar-list li');
  items.forEach((li, i) => li.classList.toggle('current', i === state.currentSlide));
}

// ---------------------------------------------------------------------------
// Hamburger
// ---------------------------------------------------------------------------

function buildHamburger() {
  const btn = document.createElement('button');
  btn.className = 'hamburger';
  btn.setAttribute('aria-label', 'Toggle slide list');
  btn.innerHTML = '<svg width="22" height="16" viewBox="0 0 22 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><line x1="0" y1="1" x2="22" y2="1"/><line x1="0" y1="8" x2="15" y2="8"/><line x1="0" y1="15" x2="18" y2="15"/></svg>';
  btn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('moui:sidebar', { detail: { action: 'toggle' } }));
  });
  document.body.appendChild(btn);
}

// ---------------------------------------------------------------------------
// Pencil (whiteboard toggle)
// ---------------------------------------------------------------------------

function buildPencilButton() {
  // Toolbar host — positioned once, toolbar flows inside it
  const toolbarHost = document.createElement('div');
  toolbarHost.style.cssText = 'position:fixed;top:20px;left:90px;z-index:80;display:flex;align-items:center;background:rgba(30,30,30,0.55);border-radius:6px;padding:5px 8px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);opacity:0;pointer-events:none;transition:opacity 0.2s;';
  document.body.appendChild(toolbarHost);

  const btn = document.createElement('button');
  btn.className = 'pencil-toggle';
  btn.setAttribute('aria-label', 'Toggle whiteboard');
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
  btn.style.cssText = 'position:fixed;top:20px;left:56px;z-index:80;background:none;border:none;cursor:pointer;padding:7px;color:#999;transition:color 0.2s, background 0.2s;border-radius:6px;outline:none;display:flex;align-items:center;justify-content:center;';

  btn.addEventListener('mouseenter', () => { if (!state.whiteboardActive) btn.style.color = '#ccc'; });
  btn.addEventListener('mouseleave', () => { if (!state.whiteboardActive) btn.style.color = '#999'; });

  btn.addEventListener('click', () => {
    state.whiteboardActive = !state.whiteboardActive;
    const viewport = document.querySelector('.viewport');
    if (state.whiteboardActive) {
      const slideId = String(state.currentSlide);
      const storageKey = 'whiteboard:' + (document.body.dataset.theme || 'default');
      mountWhiteboard(viewport, slideId, { storageKey, toolbarContainer: toolbarHost });
      toolbarHost.style.opacity = '1';
      toolbarHost.style.pointerEvents = 'auto';
      btn.style.background = 'rgba(30, 30, 30, 0.55)';
      btn.style.color = '#fff';
    } else {
      unmountWhiteboard();
      toolbarHost.style.opacity = '0';
      toolbarHost.style.pointerEvents = 'none';
      btn.style.background = 'none';
      btn.style.color = '#999';
    }
  });

  document.body.appendChild(btn);
}

// ---------------------------------------------------------------------------
// Fullscreen toggle
// ---------------------------------------------------------------------------

const FULLSCREEN_EXPAND = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>';
const FULLSCREEN_COMPRESS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/></svg>';

function buildFullscreenButton() {
  const btn = document.createElement('button');
  btn.className = 'fullscreen-toggle';
  btn.setAttribute('aria-label', 'Toggle fullscreen');
  btn.innerHTML = FULLSCREEN_EXPAND;
  btn.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('moui:fullscreen', { detail: { action: 'toggle' } }));
  });
  document.body.appendChild(btn);

  document.addEventListener('fullscreenchange', () => {
    btn.innerHTML = document.fullscreenElement ? FULLSCREEN_COMPRESS : FULLSCREEN_EXPAND;
  });
}

window.addEventListener('moui:fullscreen', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen();
  }
});

// ---------------------------------------------------------------------------
// Edge zone indicators
// ---------------------------------------------------------------------------

function buildEdgeZones() {
  const base = 'position:fixed;top:0;bottom:0;width:48px;z-index:45;pointer-events:none;mix-blend-mode:soft-light;opacity:0;transition:opacity 0.3s ease;';

  leftEdge = document.createElement('div');
  leftEdge.className = 'edge-zone-left';
  leftEdge.style.cssText = base + 'left:0;background:linear-gradient(to right, rgba(255,255,255,0.5), transparent);';
  document.body.appendChild(leftEdge);

  rightEdge = document.createElement('div');
  rightEdge.className = 'edge-zone-right';
  rightEdge.style.cssText = base + 'right:0;background:linear-gradient(to left, rgba(255,255,255,0.5), transparent);';
  document.body.appendChild(rightEdge);
}

// ---------------------------------------------------------------------------
// SSE live reload
// ---------------------------------------------------------------------------

async function subscribeSSE() {
  // Only connect if the SSE endpoint exists (dev server). Static builds have no /events.
  try {
    const probe = await fetch('./events', { method: 'HEAD' });
    if (!probe.ok) return;
  } catch (e) { return; }

  const source = new EventSource('./events');
  source.addEventListener('message', async (e) => {
    if (e.data === 'reload') {
      const { content, theme } = await loadData();
      state.slides = content.slides || [];
      state.theme = theme;
      state.deckReveal = content.reveal;
      applyCSSVariables(theme, document.documentElement);
      const link = document.getElementById('theme-styles');
      if (link) link.href = `./theme/style.css?t=${Date.now()}`;
      if (content.theme) document.body.dataset.theme = content.theme;
      render();
    }
  });
  source.addEventListener('error', () => {
    source.close();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function boot() {
  try {
    const { content, theme } = await loadData();

    let contentData;
    let activeMnemonic = null;
    if (content.encrypted) {
      state.theme = theme;
      applyCSSVariables(theme, document.documentElement);

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'theme-styles';
      link.href = './theme/style.css';
      document.head.appendChild(link);

      const hashParams = parseHash(location.hash);
      if (hashParams.access) {
        let mnemonic;
        try {
          mnemonic = base64urlDecode(hashParams.access);
        } catch (e) {
          mnemonic = null;
        }
        if (mnemonic) {
          try {
            const raw = await decryptContent(content, mnemonic);
            contentData = JSON.parse(raw);
            activeMnemonic = mnemonic;
            // Strip access from hash, keep slide if present
            const cleanParams = {};
            if (hashParams.slide) cleanParams.slide = hashParams.slide;
            history.replaceState(null, '', buildHash(cleanParams) || location.pathname);
          } catch (e) {
            const result = await promptAndDecrypt(content, content.meta?.title);
            contentData = result.content;
            activeMnemonic = result.mnemonic;
          }
        } else {
          const result = await promptAndDecrypt(content, content.meta?.title);
          contentData = result.content;
          activeMnemonic = result.mnemonic;
        }
      } else {
        const result = await promptAndDecrypt(content, content.meta?.title);
        contentData = result.content;
        activeMnemonic = result.mnemonic;
      }

      // Decrypt encrypted assets (images, artifacts) client-side before rendering.
      // Rewrites media paths in contentData to blob: URLs. The renderer never
      // sees .enc paths — same pattern as grove's asset-decrypt.js.
      await resolveEncryptedMedia(contentData, activeMnemonic);
    } else {
      contentData = content;
    }

    state.slides = contentData.slides || [];
    state.theme = theme;
    state.deckReveal = contentData.reveal;

    applyCSSVariables(theme, document.documentElement);

    const themeName = contentData.theme;
    if (!themeName) throw new Error('Content has no theme field');
    document.body.dataset.theme = themeName;

    if (!document.getElementById('theme-styles')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'theme-styles';
      link.href = './theme/style.css';
      document.head.appendChild(link);
    }

    const viewport = document.querySelector('.viewport');
    viewport.replaceChildren();
    const slide = document.createElement('div');
    slide.className = 'slide';
    viewport.appendChild(slide);

    restoreFromHash();
    buildHamburger();
    buildPencilButton();
    buildFullscreenButton();
    buildSidebar();
    buildEdgeZones();
    render();
    subscribeSSE();

    // Service worker — production only. On localhost cache-first pins stale assets.
    // Deferred to window.load so SW install never competes with page resources.
    if ('serviceWorker' in navigator) {
      const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
      if (isDev) {
        navigator.serviceWorker.getRegistrations().then(regs => {
          for (const reg of regs) reg.unregister();
        });
        if ('caches' in window) {
          caches.keys().then(keys => keys.forEach(k => caches.delete(k)));
        }
      } else {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('./sw.js?v=1779983570');
        });
      }
    }
  } catch (err) {
    const viewport = document.querySelector('.viewport');
    if (viewport) {
      viewport.replaceChildren();
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'display:flex;flex-direction:column;justify-content:center;align-items:center;height:100%;padding:2rem;text-align:center;';
      const title = document.createElement('p');
      title.style.cssText = 'font-size:1.25rem;margin-bottom:0.5rem;';
      title.textContent = 'Failed to load deck';
      const detail = document.createElement('p');
      detail.style.cssText = 'opacity:0.5;font-size:0.875rem;';
      detail.textContent = err.message;
      wrapper.appendChild(title);
      wrapper.appendChild(detail);
      viewport.appendChild(wrapper);
    }
  }
}

boot();
