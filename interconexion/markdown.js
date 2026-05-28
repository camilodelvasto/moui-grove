// markdown.js — markdown-it with ::media directive
// Requires window.markdownit (loaded via <script> from vendor/)

function parseAttributes(str) {
  const attrs = {};
  if (!str) return attrs;
  const re = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let m;
  while ((m = re.exec(str)) !== null) attrs[m[1]] = m[2] !== undefined ? m[2] : m[3];
  return attrs;
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function directivePlugin(md) {
  md.block.ruler.before('paragraph', 'directive', (state, startLine, endLine, silent) => {
    const pos = state.bMarks[startLine] + state.tShift[startLine];
    const max = state.eMarks[startLine];
    const line = state.src.slice(pos, max);
    const match = line.match(/^::(\w+)\{([^}]*)\}$/);
    if (!match) return false;
    if (silent) return true;
    const token = state.push('directive', '', 0);
    token.meta = { name: match[1], attrs: parseAttributes(match[2]) };
    token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  });

  md.renderer.rules.directive = (tokens, idx) => {
    const { name, attrs } = tokens[idx].meta;
    if (name !== 'media') return `<!-- unknown directive: ${name} -->`;
    const { src, width, caption, align = 'center' } = attrs;
    if (!src) return '<!-- media directive missing src -->';
    const resolved = `./data/${src}`;
    const style = width ? `max-width:${width}%;` : '';
    const ext = src.split('.').pop().toLowerCase();
    let media;
    if (ext === 'html') {
      media = `<iframe src="${esc(resolved)}" class="artifact-iframe" style="${style}" sandbox="allow-scripts allow-same-origin"></iframe>`;
    } else if (ext === 'csv') {
      media = `<div class="csv-table" data-csv-src="${esc(resolved)}" style="${style}">[CSV rendering not yet implemented]</div>`;
    } else {
      media = `<img src="${esc(resolved)}" alt="${esc(caption || '')}" style="${style}">`;
    }
    const cap = caption ? `<figcaption>${esc(caption)}</figcaption>` : '';
    return `<figure class="inline-media align-${align}">${media}${cap}</figure>`;
  };
}

let instance = null;

export function renderMarkdown(text) {
  if (!text) return '';
  if (!instance) {
    if (typeof window.markdownit !== 'function') {
      throw new Error('markdown-it not loaded');
    }
    instance = window.markdownit({ html: false, linkify: true, typographer: true, breaks: true });
    instance.use(directivePlugin);
  }
  return instance.render(text);
}
