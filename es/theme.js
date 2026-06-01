// theme.js — light/dark toggle. Tokens are inlined in the page head at build
// time (see exporters/themes.py), so there's no fetch and no FOUC: we only
// flip the `data-theme` attribute and let CSS do the rest.

const STORAGE_KEY = 'grove-theme';

export function applyStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    document.documentElement.setAttribute('data-theme', stored);
    return stored;
  }
  const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', preferred);
  return preferred;
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(STORAGE_KEY, next);
  return next;
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light';
}
