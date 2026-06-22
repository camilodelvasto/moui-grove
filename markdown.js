// markdown.js — Runtime markdown-it renderer for dynamic content.
// Build-time rendering uses Python. This is for search previews, live editing, etc.

let md = null;

export function init() {
  if (typeof markdownit === 'undefined') {
    console.warn('markdown-it not loaded — runtime markdown rendering unavailable');
    return;
  }
  md = markdownit('commonmark', { html: true });
}

export function render(source) {
  if (!md) throw new Error('markdown-it not initialized — call init() first');
  return md.render(source);
}

export function renderInline(source) {
  if (!md) throw new Error('markdown-it not initialized — call init() first');
  return md.renderInline(source);
}

// Safe renderer for UNTRUSTED markdown (model/corpus output, e.g. chat answers).
// html:false escapes raw HTML so a model can't inject markup; linkify is off and
// markdown-it's default validateLink blocks javascript:/vbscript: schemes. Returns
// null if the vendored lib isn't on the page, so the caller can fall back to inert
// text rather than crash. Distinct instance from the html:true post renderer above.
let mdSafe = null;

export function renderUntrusted(source) {
  if (typeof markdownit === 'undefined') return null;
  if (!mdSafe) mdSafe = markdownit({ html: false, linkify: false, breaks: true });
  return mdSafe.render(source);
}
