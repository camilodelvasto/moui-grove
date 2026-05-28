// hash-params.js — declarative hash fragment parser
// Format: #key=value&key2=value2

export function parseHash(hash) {
  const raw = (hash || '').replace(/^#/, '');
  if (!raw) return {};
  const params = {};
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue; // bare values ignored — no implicit semantics
    params[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(part.slice(eq + 1));
  }
  return params;
}

export function buildHash(params) {
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.length ? '#' + parts.join('&') : '';
}
