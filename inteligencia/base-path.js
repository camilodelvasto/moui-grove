// base-path.js — resolves the deployed base path from the HTML meta tag.
// Build-time inject: <meta name="grove-base-path" content="/grove">.
// For root deploys the content is empty string.

export function getBasePath() {
  const el = document.querySelector('meta[name="grove-base-path"]');
  if (!el) throw new Error('Missing <meta name="grove-base-path">');
  const content = el.getAttribute('content');
  if (content === null) throw new Error('<meta name="grove-base-path"> has no content attribute');
  return content;
}

export function withBasePath(path) {
  const base = getBasePath();
  if (!path.startsWith('/')) return path;
  return base + path;
}
