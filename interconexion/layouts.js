// layouts.js — five layout render functions for the moui deck renderer
// Each function takes (slide, themeData) and returns a DocumentFragment.

import { resolveColor, resolveBackground, resolvePadding, extractThemeParts, serializeThemeVars, resolveEffects, resolveToken, resolveDividerCSS } from './theme.js?v=1779983429';
import { renderMarkdown } from './markdown.js?v=1779983429';

// ---------------------------------------------------------------------------
// DOM primitives
// ---------------------------------------------------------------------------

export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') {
        if (v) node.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        for (const [prop, val] of Object.entries(v)) {
          if (val !== undefined && val !== null) node.style[prop] = val;
        }
      } else if (k.startsWith('data-')) {
        node.setAttribute(k, v);
      } else {
        node.setAttribute(k, v);
      }
    }
  }
  for (const child of children) {
    if (child == null) continue;
    if (child instanceof Node) {
      node.appendChild(child);
    } else {
      node.appendChild(document.createTextNode(String(child)));
    }
  }
  return node;
}

export function htmlEl(tag, attrs, html) {
  const node = el(tag, attrs);
  node.innerHTML = html;
  return node;
}

// ---------------------------------------------------------------------------
// Path enforcement — only local relative paths are allowed
// ---------------------------------------------------------------------------

const REMOTE_PREFIXES = ['http:', 'https:', 'data:', 'file:', '//'];

export function assertLocalPath(src) {
  if (!src || typeof src !== 'string') throw new Error('assertLocalPath: src is required');
  const lower = src.toLowerCase().trim();
  for (const prefix of REMOTE_PREFIXES) {
    if (lower.startsWith(prefix)) {
      throw new Error(`Remote paths are not allowed: "${src}". Only local relative paths can be used.`);
    }
  }
  if (src.startsWith('/')) {
    throw new Error(`Absolute paths are not allowed: "${src}". Use a relative path from the corpus root.`);
  }
  return src;
}

// ---------------------------------------------------------------------------
// Divider element builder
// ---------------------------------------------------------------------------

function createDivider(style, orientation, themeData) {
  if (!style || !style.divider) return null;
  const resolved = resolveToken(style.divider, themeData);
  const css = resolveDividerCSS(resolved, orientation);
  if (!css) return null;
  const div = el('div', { class: `divider divider-${orientation}` });
  for (const [prop, val] of Object.entries(css)) {
    div.style[prop] = val;
  }
  return div;
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export function renderMedia(src, caption, themeData, opts) {
  if (!src) throw new Error('renderMedia: src is required');
  if (!themeData) throw new Error('renderMedia: themeData is required');
  assertLocalPath(src);
  const ext = src.split('.').pop().toLowerCase();
  const resolved = `./data/${src}`;
  let media;
  if (ext === 'svg' || ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'webp') {
    media = el('img', { src: resolved, alt: caption || '' });
  } else if (ext === 'html') {
    // allow-same-origin is required for CSS custom property inheritance via
    // contentDocument. This is a known tradeoff — artifacts run on the same
    // origin as the renderer. Artifacts must be trusted content (assertLocalPath
    // blocks all remote URLs).
    media = el('iframe', {
      src: resolved,
      class: 'artifact-iframe',
      sandbox: 'allow-scripts allow-same-origin',
    });
    media.addEventListener('load', () => {
      if (!document.contains(media)) return;
      const doc = media.contentDocument;
      if (!doc) return;
      const style = doc.createElement('style');
      style.textContent = `:root { ${serializeThemeVars(themeData)} }`;
      doc.head.appendChild(style);
    });
  } else if (ext === 'csv') {
    media = el('div', { class: 'csv-table', 'data-csv-src': resolved });
    media.textContent = '[CSV rendering not yet implemented]';
  } else {
    throw new Error(`renderMedia: unsupported extension ".${ext}" for src "${src}"`);
  }
  const fig = el('figure', { class: 'slide-media' }, media);
  if (ext === 'html') {
    fig.classList.add('slide-media-artifact');
    fig.style.position = 'relative';
    if (!(opts && opts.interactive)) {
      const overlay = document.createElement('div');
      overlay.className = 'artifact-overlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:auto;';
      fig.appendChild(overlay);
    }
  }
  if (caption) fig.appendChild(el('figcaption', null, caption));
  return fig;
}

// ---------------------------------------------------------------------------
// Content block builder
// ---------------------------------------------------------------------------

export async function loadComponent(name) {
  const cached = loadComponent._cache || (loadComponent._cache = {});
  if (cached[name]) return cached[name];

  // Inject CSS if not already loaded
  const linkId = `component-styles-${name}`;
  if (!document.getElementById(linkId)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.id = linkId;
    link.href = `./components/${name}/style.css`;
    document.head.appendChild(link);
  }

  const mod = await import(`./components/${name}/render.js`);
  if (typeof mod.render !== 'function') {
    throw new Error(`Component '${name}' render.js must export a render function`);
  }
  cached[name] = mod;
  return mod;
}

export function buildContentBlock(content, style, themeData, startStagger) {
  if (!content) throw new Error('buildContentBlock: content is required');

  // Component dispatch — returns a placeholder that gets replaced async
  if (content.component) {
    const wrapper = document.createElement('div');
    wrapper.dataset.component = content.component;
    if (startStagger >= 0) wrapper.setAttribute('data-stagger', String(startStagger));
    loadComponent(content.component).then(mod => {
      const frag = mod.render(content.data || {}, themeData);
      wrapper.appendChild(frag);
    });
    return wrapper;
  }

  const skipStagger = startStagger < 0;
  const stagger = skipStagger ? 0 : (startStagger ?? 0);
  const frag = document.createDocumentFragment();

  function maybeStagger(node, idx) {
    if (!skipStagger) node.setAttribute('data-stagger', stagger + idx);
  }

  if (content.label != null) {
    const node = el('p', { class: 'label' }, String(content.label));
    maybeStagger(node, 0);
    applyElementStyle(node, 'label', style, themeData);
    frag.appendChild(node);
  }
  if (content.heading != null) {
    const node = el('h1', { class: 'heading' }, String(content.heading));
    maybeStagger(node, 1);
    applyElementStyle(node, 'heading', style, themeData);
    frag.appendChild(node);
  }
  if (content.subheading != null) {
    const node = el('p', { class: 'subheading' }, String(content.subheading));
    maybeStagger(node, 2);
    applyElementStyle(node, 'subheading', style, themeData);
    frag.appendChild(node);
  }
  if (content.body != null) {
    const node = htmlEl('div', { class: 'body' }, renderMarkdown(content.body));
    maybeStagger(node, 3);
    applyElementStyle(node, 'body', style, themeData);
    frag.appendChild(node);
  }
  if (content.quote != null) {
    const node = el('blockquote', { class: 'quote' }, String(content.quote));
    maybeStagger(node, 3);
    frag.appendChild(node);
  }
  if (content.attribution != null) {
    const node = el('p', { class: 'attribution' }, String(content.attribution));
    maybeStagger(node, 4);
    applyElementStyle(node, 'attribution', style, themeData);
    frag.appendChild(node);
  }
  if (content.media != null) {
    const fig = renderMedia(content.media, content.caption, themeData, { interactive: !!content.interactive });
    maybeStagger(fig, 5);
    frag.appendChild(fig);
  }

  return frag;
}

// ---------------------------------------------------------------------------
// Effect applier — writes resolved effect config as inline CSS vars on the element.
// ---------------------------------------------------------------------------

export function applyResolvedEffects(element, resolved) {
  if (!resolved || resolved.length === 0) return;
  element.dataset.effect = resolved.map(e => e.name).join(' ');
  for (const { name, config } of resolved) {
    if (!config) continue;
    for (const [key, value] of Object.entries(config)) {
      if (value === undefined || value === null) continue;
      if (key === 'loop') {
        if (value === true) {
          element.style.setProperty(`--effect-${name}-iterations`, 'infinite');
          element.style.setProperty(`--effect-${name}-fill`, 'none');
        } else {
          element.style.setProperty(`--effect-${name}-iterations`, '1');
          element.style.setProperty(`--effect-${name}-fill`, 'forwards');
        }
      } else if (key === 'colors' && Array.isArray(value)) {
        value.forEach((c, i) => {
          element.style.setProperty(`--effect-${name}-color-${i}`, String(c));
        });
      } else {
        element.style.setProperty(`--effect-${name}-${key}`, String(value));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Element style applicator — reads style siblings for content elements
// ---------------------------------------------------------------------------

export function applyElementStyle(element, elementName, style, themeData) {
  if (!style || !style[elementName]) return;
  const es = style[elementName];
  const { palette, assignments } = extractThemeParts(themeData);

  if (es.size) element.classList.add(`size-${es.size}`);
  if (es.align) element.style.textAlign = es.align;
  if (es.color) element.style.color = resolveColor(es.color, palette, assignments);
  if (es.weight) element.style.fontWeight = String(es.weight);
  if (es.effect != null) {
    const resolved = resolveEffects(es.effect, themeData);
    applyResolvedEffects(element, resolved);
  }
  if (es.maxHeight) element.style.maxHeight = es.maxHeight;
  if (es.maxWidth) element.style.maxWidth = es.maxWidth;
}

// ---------------------------------------------------------------------------
// Region style applicator
// ---------------------------------------------------------------------------

export function applyRegionStyles(element, style, themeData) {
  if (!style) return;
  const { palette, assignments } = extractThemeParts(themeData);

  if (style.bg != null) {
    const bg = resolveBackground(style.bg, palette, assignments);
    if (bg) element.style.background = bg;
  }
  if (style.color != null) {
    const color = resolveColor(style.color, palette, assignments);
    if (color) element.style.color = color;
  }
  if (style.align != null) {
    element.style.textAlign = style.align;
  }
  if (style.valign != null) {
    const valignMap = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
    element.style.justifyContent = valignMap[style.valign] || style.valign;
  }
  if (style.padding != null) {
    const pad = resolvePadding(style.padding, themeData);
    if (pad) element.style.padding = pad;
  }
}

// ---------------------------------------------------------------------------
// Layout: cover
// ---------------------------------------------------------------------------

export function renderCover(slide, themeData) {
  const frag = document.createDocumentFragment();
  const content = slide.content || {};
  const style = slide.style || {};
  const meta = slide.meta || {};

  const wrapper = el('div', { class: 'layout-cover' });
  const { bg: _coverBg, ...coverRegion } = style;
  applyRegionStyles(wrapper, coverRegion, themeData);

  if (content.media != null) {
    const fig = renderMedia(content.media, content.caption ?? null, themeData);
    fig.setAttribute('data-stagger', '0');
    applyElementStyle(fig, 'media', style, themeData);
    wrapper.appendChild(fig);
  }
  if (content.label != null) {
    const node = el('p', { class: 'label', 'data-stagger': '0' }, String(content.label));
    applyElementStyle(node, 'label', style, themeData);
    wrapper.appendChild(node);
  }
  if (content.heading != null) {
    const node = el('h1', { class: 'heading', 'data-stagger': '1' }, String(content.heading));
    applyElementStyle(node, 'heading', style, themeData);
    wrapper.appendChild(node);
  }
  if (content.subheading != null) {
    const node = el('p', { class: 'subheading', 'data-stagger': '2' }, String(content.subheading));
    applyElementStyle(node, 'subheading', style, themeData);
    wrapper.appendChild(node);
  }

  const hasMeta = meta.author != null || meta.date != null;
  if (hasMeta) {
    const metaEl = el('div', { class: 'cover-meta', 'data-stagger': '3' });
    if (meta.author != null) metaEl.appendChild(el('span', { class: 'author' }, String(meta.author)));
    if (meta.date != null) metaEl.appendChild(el('span', { class: 'date' }, String(meta.date)));
    wrapper.appendChild(metaEl);
  }

  frag.appendChild(wrapper);
  return frag;
}

// ---------------------------------------------------------------------------
// Layout: statement
// ---------------------------------------------------------------------------

export function renderStatement(slide, themeData) {
  const frag = document.createDocumentFragment();
  const content = slide.content || {};
  const style = slide.style || {};

  // Size: slide overrides theme. Theme must declare default-statement-size.
  const size = (style.heading && style.heading.size) || themeData['default-statement-size'];
  if (!size) throw new Error(`renderStatement: no size resolved — declare default-statement-size in theme (slide: ${slide.id || 'unnamed'})`);
  const wrapper = el('div', { class: `layout-statement size-${size}` });
  const { bg: _stmtBg, ...stmtRegion } = style;
  applyRegionStyles(wrapper, stmtRegion, themeData);

  if (content.heading != null) {
    const node = el('h1', { class: 'heading', 'data-stagger': '1' }, String(content.heading));
    applyElementStyle(node, 'heading', style, themeData);
    wrapper.appendChild(node);
  }
  if (content.body != null) {
    const node = htmlEl('div', { class: 'body', 'data-stagger': '2' }, renderMarkdown(content.body));
    applyElementStyle(node, 'body', style, themeData);
    wrapper.appendChild(node);
  }

  frag.appendChild(wrapper);
  return frag;
}

// ---------------------------------------------------------------------------
// Layout: full
// ---------------------------------------------------------------------------

export function renderFull(slide, themeData) {
  const frag = document.createDocumentFragment();
  const content = slide.content || {};
  const style = slide.style || {};

  const classes = ['layout-full'];
  if (style.scroll) classes.push('scrollable');

  const wrapper = el('div', { class: classes.join(' ') });
  const { bg: _fullBg, ...fullRegion } = style;
  applyRegionStyles(wrapper, fullRegion, themeData);

  wrapper.appendChild(buildContentBlock(content, style, themeData, 0));

  frag.appendChild(wrapper);
  return frag;
}

// ---------------------------------------------------------------------------
// Layout: split
// ---------------------------------------------------------------------------

export function renderSplit(slide, themeData) {
  const frag = document.createDocumentFragment();
  const style = slide.style || {};
  const left = slide.left || {};
  const right = slide.right || {};
  const content = slide.content || {};

  const wrapper = el('div', { class: 'layout-split' });
  const { bg: _splitBg, ...splitRegion } = style;
  applyRegionStyles(wrapper, splitRegion, themeData);

  if (style.ratio) {
    const [l, r] = String(style.ratio).split('/');
    if (l && r) {
      wrapper.style.setProperty('--split-left', l.trim() + 'fr');
      wrapper.style.setProperty('--split-right', r.trim() + 'fr');
    }
  }

  const hasHeader =
    content.label != null ||
    content.heading != null ||
    content.subheading != null ||
    content.body != null ||
    content.quote != null ||
    content.attribution != null ||
    content.media != null;

  let panelStaggerBase = 0;
  if (hasHeader) {
    wrapper.classList.add('has-header');
    const header = el('div', { class: 'split-header' });
    header.appendChild(buildContentBlock(content, style, themeData, 0));
    wrapper.appendChild(header);
    panelStaggerBase = 1;
  }

  const leftPanel = el('div', { class: 'panel panel-left', 'data-stagger': String(panelStaggerBase) });
  applyRegionStyles(leftPanel, left.style || {}, themeData);
  if (left.style && left.style.scroll) leftPanel.classList.add('scrollable');
  leftPanel.appendChild(buildContentBlock(left.content || {}, left.style || {}, themeData, -1));

  const rightPanel = el('div', { class: 'panel panel-right', 'data-stagger': String(panelStaggerBase + 1) });
  applyRegionStyles(rightPanel, right.style || {}, themeData);
  if (right.style && right.style.scroll) rightPanel.classList.add('scrollable');
  rightPanel.appendChild(buildContentBlock(right.content || {}, right.style || {}, themeData, -1));

  // Vertical divider — check panel-level first, then slide-level
  const dividerStyle = (left.style && left.style.divider) ? left.style : style;
  const vDivider = createDivider(dividerStyle, 'v', themeData);
  if (vDivider) leftPanel.appendChild(vDivider);

  wrapper.appendChild(leftPanel);
  wrapper.appendChild(rightPanel);

  frag.appendChild(wrapper);
  return frag;
}

// ---------------------------------------------------------------------------
// Layout: split-stack
// ---------------------------------------------------------------------------

function buildSide(side, name, slideStyle, themeData, staggerBase) {
  const hasPanels = Array.isArray(side.panels) && side.panels.length > 0;

  if (hasPanels) {
    const container = el('div', {
      class: `panel panel-${name} panel-stacked`,
      style: { '--stack-count': String(side.panels.length) }
    });
    applyRegionStyles(container, side.style || {}, themeData);

    side.panels.forEach((panel, i) => {
      const panelEl = el('div', {
        class: 'stacked-panel',
        'data-stagger': String(staggerBase + i)
      });
      applyRegionStyles(panelEl, panel.style || {}, themeData);
      if (panel.style && panel.style.scroll) panelEl.classList.add('scrollable');
      panelEl.appendChild(buildContentBlock(panel.content || {}, panel.style || {}, themeData, -1));
      container.appendChild(panelEl);

      // Horizontal divider after this panel (if panel declares divider and not last)
      if (panel.style && panel.style.divider && i < side.panels.length - 1) {
        const hDivider = createDivider(panel.style, 'h', themeData);
        if (hDivider) container.appendChild(hDivider);
      }
    });

    return container;
  }

  // Single content panel — same as regular split
  const panel = el('div', {
    class: `panel panel-${name}`,
    'data-stagger': String(staggerBase)
  });
  applyRegionStyles(panel, side.style || {}, themeData);
  if (side.style && side.style.scroll) panel.classList.add('scrollable');
  panel.appendChild(buildContentBlock(side.content || {}, side.style || {}, themeData, -1));
  return panel;
}

export function renderSplitStack(slide, themeData) {
  const frag = document.createDocumentFragment();
  const style = slide.style || {};
  const left = slide.left || {};
  const right = slide.right || {};
  const content = slide.content || {};

  const wrapper = el('div', { class: 'layout-split-stack' });
  const { bg: _ssBg, ...ssRegion } = style;
  applyRegionStyles(wrapper, ssRegion, themeData);

  if (style.ratio) {
    const [l, r] = String(style.ratio).split('/');
    if (l && r) {
      wrapper.style.setProperty('--split-left', l.trim() + 'fr');
      wrapper.style.setProperty('--split-right', r.trim() + 'fr');
    }
  }

  const hasHeader =
    content.label != null ||
    content.heading != null ||
    content.subheading != null ||
    content.body != null ||
    content.quote != null ||
    content.attribution != null ||
    content.media != null;

  let staggerIdx = 0;
  if (hasHeader) {
    wrapper.classList.add('has-header');
    const header = el('div', { class: 'split-stack-header' });
    header.appendChild(buildContentBlock(content, style, themeData, 0));
    wrapper.appendChild(header);
    staggerIdx = 1;
  }

  const leftPanel = buildSide(left, 'left', style, themeData, staggerIdx);
  const leftCount = left.panels ? left.panels.length : 1;
  const rightPanel = buildSide(right, 'right', style, themeData, staggerIdx + leftCount);

  // Vertical divider — check panel-level first, then slide-level
  const dividerStyle = (left.style && left.style.divider) ? left.style : style;
  const vDivider = createDivider(dividerStyle, 'v', themeData);
  if (vDivider) leftPanel.appendChild(vDivider);

  wrapper.appendChild(leftPanel);
  wrapper.appendChild(rightPanel);

  frag.appendChild(wrapper);
  return frag;
}

// ---------------------------------------------------------------------------
// Layout: grid
// ---------------------------------------------------------------------------

export function renderGrid(slide, themeData) {
  const frag = document.createDocumentFragment();
  const style = slide.style || {};
  const cells = slide.cells || [];

  const wrapper = el('div', { class: 'layout-grid' });
  const { bg: _gridBg, ...gridRegion } = style;
  applyRegionStyles(wrapper, gridRegion, themeData);

  if (style.columns != null) {
    wrapper.style.setProperty('--grid-columns', String(style.columns));
  }

  for (const cell of cells) {
    const cellEl = el('div', { class: 'grid-cell' });
    applyRegionStyles(cellEl, cell.style || {}, themeData);
    if (cell.style && cell.style.scroll) cellEl.classList.add('scrollable');
    cellEl.appendChild(buildContentBlock(cell.content || {}, cell.style || {}, themeData, 0));
    wrapper.appendChild(cellEl);
  }

  frag.appendChild(wrapper);
  return frag;
}
