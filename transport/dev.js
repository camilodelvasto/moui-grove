/**Dev transport — 12-method transport contract backed by server fetches.
 *
 * Used when <meta name="grove-env" content="dev"> is present.
 * loadPage fetches fragments from /_dev/content?route=.
 * Store methods use in-memory Maps (ephemeral — reset on reload).
 * This is acceptable for dev — authoring, not persistence testing.
 */

import { withBasePath } from '../base-path.js';

const _stores = {};
function _getStore(name) {
  if (!_stores[name]) _stores[name] = new Map();
  return _stores[name];
}

const INDEX_PATHS = {
  'first-load': '/first-load-index.json',
  'search': '/search-index.json',
};

export const devTransport = {
  async loadPage(path) {
    const res = await fetch('/_dev/content?route=' + encodeURIComponent(path));
    if (!res.ok) return null;
    const data = await res.json();
    // layout/width travel with the fragment so the router can set body data-layout on
    // navigation — dev has no manifest, so onBeforeNavigate can't (see router._swap).
    return { html: data.html, layout: data.layout, width: data.width };
  },

  async fetchFeed() {
    const res = await fetch(withBasePath('/feed.xml'));
    return res.text();
  },

  async fetchPage(url) {
    const res = await fetch(url);
    return { ok: res.ok, url, clone: () => res.clone(), text: () => res.text() };
  },

  async cachePage() {
    // No-op in dev — no SW, no cache
  },

  async getIndex(name) {
    const path = INDEX_PATHS[name];
    if (!path) throw new Error(`Unknown index: ${name}`);
    const res = await fetch(withBasePath(path));
    return res.json();
  },

  async storeOpen() {
    // No-op — in-memory stores, no IDB
  },

  async storePut(storeName, value, key) {
    const store = _getStore(storeName);
    const k = key !== undefined ? key : (value.path || value.route || JSON.stringify(value));
    store.set(k, value);
  },

  async storeGet(storeName, key) {
    return _getStore(storeName).get(key);
  },

  async storeGetAll(storeName) {
    return Array.from(_getStore(storeName).values());
  },

  async storeQueryByIndex(storeName, indexName, value) {
    const all = Array.from(_getStore(storeName).values());
    return all.filter(item => {
      const field = item[indexName];
      return Array.isArray(field) ? field.includes(value) : field === value;
    });
  },

  async getMeta(key) {
    return _getStore('user_state').get(key);
  },

  async setMeta(key, value) {
    _getStore('user_state').set(key, value);
  },
};
