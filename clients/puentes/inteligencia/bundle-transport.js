// bundle-transport.js — Transport that serves from a decrypted in-memory bundle.
//
// After the gate decrypts bundle.enc, it calls initBundleTransport(bundle)
// which stores the parsed bundle in memory and exposes a transport object
// implementing the same contract as webTransport.
//
// Router, search, indexer all work unchanged — they talk to the transport
// contract, which reads from memory instead of fetching from the server.

import { getBasePath } from './base-path.js';
import { resolveEncryptedImages } from './asset-decrypt.js';

let _bundle = null;
let _mnemonic = null;
// In-memory store — encrypted groves don't use IndexedDB.
// Module-level (not object property) so transport proxy calls work
// without `this` binding.
const _stores = {};

export function initBundleTransport(bundle) {
  if (typeof bundle === 'string') {
    _bundle = JSON.parse(bundle);
  } else {
    _bundle = bundle;
  }
}

export function setBundleMnemonic(mnemonic) {
  _mnemonic = mnemonic;
}

function _resolvePath(path) {
  const basePath = getBasePath();
  let normalized = path;
  if (basePath && normalized.startsWith(basePath)) {
    normalized = normalized.slice(basePath.length);
  }
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  if (!normalized.endsWith('/') && !normalized.includes('.')) normalized += '/';
  return normalized;
}

function _buildFragment(pageData) {
  // Return a <main> fragment — pure content, no document wrapper.
  // Metadata (title, layout) travels through getBundleEntry, not HTML.
  const toc = pageData.toc
    ? `\n<script type="application/json" id="toc-data">${JSON.stringify(pageData.toc)}</script>`
    : '';
  return pageData.main + toc;
}

/**
 * Get metadata for a route from the decrypted bundle.
 * Same role as manifest.getEntry — metadata separate from content.
 * Returns { title, layout, theme } or null if route not found.
 */
export function getBundleEntry(path) {
  if (!_bundle) return null;
  const normalized = _resolvePath(path);
  const page = _bundle.pages[normalized];
  if (!page) return null;
  return {
    title: page.title || '',
    layout: page.layout || 'article',
    theme: page.theme || '',
  };
}

export function getAssetManifest() {
  if (!_bundle) return null;
  return _bundle.assetManifest || null;
}

export const bundleTransport = {
  async loadPage(path) {
    if (!_bundle) return null;
    const normalized = _resolvePath(path);
    const page = _bundle.pages[normalized];
    if (!page) return null;
    let html = _buildFragment(page);

    // Pre-inject rewrite: decrypt .enc images → blob URLs before DOM injection.
    // The browser never sees .enc paths. resolveEncryptedImages returns the
    // full document string, so no re-wrapping needed.
    if (_mnemonic && _bundle.assetManifest) {
      html = await resolveEncryptedImages(
        html, _bundle.assetManifest, _mnemonic, _bundle.assetSalt
      );
    }

    return { html };
  },

  async fetchFeed() {
    // No feeds in encrypted groves
    return '';
  },

  async fetchPage(url) {
    // Used by feed module — no-op for encrypted groves
    return { ok: false, url, clone: () => ({}), text: () => '' };
  },

  async cachePage() {
    // No caching needed — bundle is in memory
  },

  async getIndex(name) {
    if (!_bundle) throw new Error('Bundle not loaded');
    if (name === 'first-load') return _bundle.firstLoadIndex || [];
    if (name === 'search') return _bundle.searchIndex || [];
    throw new Error(`Unknown index: ${name}`);
  },

  async storeOpen() {
    // No-op
  },

  async storePut(storeName, value, key) {
    if (!_stores[storeName]) _stores[storeName] = new Map();
    _stores[storeName].set(key, value);
  },

  async storeGet(storeName, key) {
    if (!_stores[storeName]) return undefined;
    return _stores[storeName].get(key);
  },

  async storeGetAll(storeName) {
    if (!_stores[storeName]) return [];
    return Array.from(_stores[storeName].values());
  },

  async storeQueryByIndex(storeName, indexName, value) {
    const all = await bundleTransport.storeGetAll(storeName);
    return all.filter(item => {
      const field = item[indexName];
      return Array.isArray(field) ? field.includes(value) : field === value;
    });
  },

  async getMeta(key) {
    if (!_stores['user_state']) return undefined;
    return _stores['user_state'].get(key);
  },

  async setMeta(key, value) {
    if (!_stores['user_state']) _stores['user_state'] = new Map();
    _stores['user_state'].set(key, value);
  },
};
