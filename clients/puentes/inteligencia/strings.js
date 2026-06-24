// strings.js — System strings loaded from build-injected JSON.
// Separate module to avoid circular imports (app.js imports components
// that need strings, so strings can't live in app.js).

function _load() {
  const el = document.getElementById('strings-data');
  if (!el) return {};
  return JSON.parse(el.textContent);
}

export const strings = _load();
