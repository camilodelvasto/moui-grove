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
