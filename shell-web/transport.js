// shell-web/transport.js — Web shell: fetch + IndexedDB + Cache API.

import { withBasePath } from '../base-path.js';

const DB_NAME = 'grove';
const DB_VERSION = 2;
let _db = null;

const INDEX_PATHS = {
  'first-load': '/first-load-index.json',
  'search': '/search-index.json',
};

async function _openDb() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('posts_index')) {
        const posts = db.createObjectStore('posts_index', { keyPath: 'path' });
        posts.createIndex('section', 'section', { unique: false });
        posts.createIndex('date', 'date', { unique: false });
        posts.createIndex('tags', 'tags', { unique: false, multiEntry: true });
      }
      if (!db.objectStoreNames.contains('search_corpus')) {
        db.createObjectStore('search_corpus', { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains('user_state')) {
        db.createObjectStore('user_state');
      }
      // New stores (v2) — content blobs + manifest version tracking
      if (!db.objectStoreNames.contains('content')) {
        const content = db.createObjectStore('content', { keyPath: 'route' });
        content.createIndex('section', 'section', { unique: false });
        content.createIndex('date', 'date', { unique: false });
        content.createIndex('tags', 'tags', { unique: false, multiEntry: true });
        content.createIndex('priority', 'priority', { unique: false });
      }
      if (!db.objectStoreNames.contains('manifest_meta')) {
        db.createObjectStore('manifest_meta');
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn('[grove] Database upgrade blocked — close other tabs to update.');
    };
  });
}

// Close IDB when leaving the page so Safari can use bfcache.
// Reopens automatically on next _openDb() call (e.g. pageshow after restore).
window.addEventListener('pagehide', () => {
  if (_db) {
    _db.close();
    _db = null;
  }
});

async function _idbRequest(storeName, mode, fn) {
  const db = await _openDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const webTransport = {
  async loadPage(path) {
    // Read from IDB content store. No fallback. If content is missing,
    // bootstrap didn't run — that's a real error, not a network fetch.
    const record = await _idbRequest('content', 'readonly', (store) => store.get(path));
    if (record && record.html) return { html: record.html };
    return null;
  },

  async fetchFeed() {
    const res = await fetch(withBasePath('/feed.xml'));
    return res.text();
  },

  async fetchPage(url) {
    const res = await fetch(url);
    return {
      ok: res.ok,
      url,
      clone: () => res.clone(),
      text: () => res.text(),
    };
  },

  async cachePage(url, response) {
    if (!('caches' in self)) return;
    const cache = await caches.open('grove-pages');
    await cache.put(url, response.clone());
  },

  async getIndex(name) {
    const path = INDEX_PATHS[name];
    if (!path) throw new Error(`Unknown index: ${name}`);
    const res = await fetch(withBasePath(path));
    return res.json();
  },

  async storeOpen() {
    await _openDb();
  },

  async storePut(storeName, value, key) {
    return _idbRequest(storeName, 'readwrite', (store) =>
      key !== undefined ? store.put(value, key) : store.put(value)
    );
  },

  async storeGet(storeName, key) {
    return _idbRequest(storeName, 'readonly', (store) => store.get(key));
  },

  async storeGetAll(storeName) {
    return _idbRequest(storeName, 'readonly', (store) => store.getAll());
  },

  async storeQueryByIndex(storeName, indexName, value) {
    const db = await _openDb();
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const idx = store.index(indexName);
    return new Promise((resolve, reject) => {
      const req = idx.getAll(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async getMeta(key) {
    return _idbRequest('user_state', 'readonly', (store) => store.get(key));
  },

  async setMeta(key, value) {
    return _idbRequest('user_state', 'readwrite', (store) => store.put(value, key));
  },
};
