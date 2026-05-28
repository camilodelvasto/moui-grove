// renderer.js — slide dispatch, reveal animation, edge-strip navigation, effect dispatch

import { renderCover, renderStatement, renderFull, renderSplit, renderSplitStack, renderGrid, applyResolvedEffects } from './layouts.js?v=1779983983';
import { resolveBackground, resolveColor, extractThemeParts, resolveReveal, resolveEffects, relativeLuminance } from './theme.js?v=1779983983';

const LAYOUTS = { cover: renderCover, statement: renderStatement, full: renderFull, bleed: renderFull, split: renderSplit, 'split-stack': renderSplitStack, grid: renderGrid };

// ---------------------------------------------------------------------------
// Edge strips — the platform's claim on the perimeter of every slide.
// Always present, never removed. Interactive artifacts get clicks in the
// center; the outer 48px on each side belongs to navigation.
// ---------------------------------------------------------------------------

const EDGE_W = 48;
const TAP_MAX_MS = 300;
const TAP_MAX_PX = 10;

function createEdgeStrip(direction) {
  const strip = document.createElement('div');
  strip.className = `slide-edge slide-edge-${direction}`;
  strip.style.cssText =
    `position:absolute;top:0;${direction === 'left' ? 'left:0' : 'right:0'};` +
    `width:${EDGE_W}px;height:100%;z-index:10;pointer-events:auto;`;

  let downX = 0, downY = 0, downTime = 0;

  strip.addEventListener('pointerdown', (e) => {
    downX = e.clientX;
    downY = e.clientY;
    downTime = performance.now();
  });

  strip.addEventListener('pointerup', (e) => {
    const elapsed = performance.now() - downTime;
    const dx = Math.abs(e.clientX - downX);
    const dy = Math.abs(e.clientY - downY);
    if (elapsed >= TAP_MAX_MS || dx >= TAP_MAX_PX || dy >= TAP_MAX_PX) return;

    const nav = direction === 'left' ? 'prev' : 'next';
    window.dispatchEvent(new CustomEvent('moui:navigate', { detail: { direction: nav } }));
  });

  return strip;
}

const BASE_DELAYS = [100, 250, 380, 500, 620];
const BASE_DURATIONS = [260, 280, 300, 260, 250];

function getDelay(index, speed) {
  const base = index < BASE_DELAYS.length ? BASE_DELAYS[index] : 100 + index * 140;
  return base * speed;
}

function getDuration(index, speed) {
  const base = index < BASE_DURATIONS.length ? BASE_DURATIONS[index] : 280;
  return base * speed;
}

function animateReveal(slideEl, reveal) {
  if (reveal.type === 'none') {
    slideEl.style.visibility = 'visible';
    slideEl.querySelectorAll('[data-stagger]').forEach(el => el.classList.add('visible'));
    return;
  }

  // data-reveal-type already set before DOM insertion
  slideEl.style.visibility = 'visible';

  const els = slideEl.querySelectorAll('[data-stagger]');
  if (!reveal.stagger) {
    const delay = getDelay(0, reveal.speed);
    els.forEach(el => {
      el.style.transitionDuration = `${getDuration(0, reveal.speed)}ms`;
      setTimeout(() => el.classList.add('visible'), delay);
    });
    return;
  }

  requestAnimationFrame(() => {
    els.forEach(el => {
      const idx = parseInt(el.dataset.stagger, 10);
      const delay = getDelay(idx, reveal.speed);
      const duration = getDuration(idx, reveal.speed);
      el.style.transitionDuration = `${duration}ms`;
      setTimeout(() => el.classList.add('visible'), delay);
    });
  });
}

export function renderSlide(slide, themeData, container, deckReveal) {
  const fn = LAYOUTS[slide.layout];
  if (!fn) { container.replaceChildren(document.createTextNode(`Unknown layout: ${slide.layout}`)); return; }

  const slideEl = document.createElement('div');
  slideEl.className = `slide slide-${slide.layout}`;
  slideEl.dataset.layout = slide.layout;
  if (slide.id) slideEl.id = slide.id;

  const s = slide.style || {};
  if (s.flush) slideEl.classList.add('flush');
  if (s.scroll && slide.layout !== 'split') slideEl.classList.add('scrollable');

  const { palette, assignments } = extractThemeParts(themeData);
  if (s.bg) {
    slideEl.style.background = resolveBackground(s.bg, palette, assignments);
    const resolved = resolveColor(s.bg, palette, assignments);
    if (resolved && resolved.startsWith('#') && relativeLuminance(resolved) < 0.4) {
      slideEl.dataset.bgDark = '';
    }
  }
  if (s.color) slideEl.style.color = resolveColor(s.color, palette, assignments);
  if (s.align) slideEl.dataset.align = s.align;
  if (s.valign) slideEl.dataset.valign = s.valign;

  // Resolve reveal BEFORE inserting into DOM — CSS initial transform depends on data-reveal-type
  const reveal = resolveReveal(themeData, deckReveal, s.reveal);
  slideEl.dataset.revealType = reveal.type;

  // Region-level effects go through the same resolver as element-level effects.
  if (s.effect != null) {
    const resolved = resolveEffects(s.effect, themeData);
    applyResolvedEffects(slideEl, resolved);
  }

  slideEl.appendChild(fn(slide, themeData));
  slideEl.appendChild(createEdgeStrip('left'));
  slideEl.appendChild(createEdgeStrip('right'));
  slideEl.style.visibility = 'hidden';

  // Scrollable slides: the viewport becomes the scroll container so the
  // slide's background (height: auto, min-height: 100%) covers all content.
  const isScrollable = slideEl.classList.contains('scrollable');
  container.classList.toggle('scrollable-active', isScrollable);
  container.replaceChildren(slideEl);
  if (isScrollable) container.scrollTop = 0;

  animateReveal(slideEl, reveal);
}
