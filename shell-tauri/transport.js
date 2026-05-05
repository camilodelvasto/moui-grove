// shell-tauri/transport.js — Tauri shell: invoke() IPC to Rust backend.
// Rust commands are not implemented yet. This wires the JS side
// so that when the Rust handlers exist, the integration is immediate.

function _invoke(cmd, args) {
  const { invoke } = window.__TAURI__.core;
  return invoke(cmd, args);
}

export const tauriTransport = {
  async loadPage(path) {
    return _invoke('grove_load_page', { path });
  },

  async fetchFeed() {
    return _invoke('grove_fetch_feed');
  },

  async fetchPage(url) {
    const result = await _invoke('grove_fetch_page', { url });
    return { ok: true, url, clone: () => result, text: () => result.html };
  },

  async cachePage(_url, _response) {
    // Tauri apps serve from filesystem — no cache layer needed.
  },

  async getIndex(name) {
    return _invoke('grove_get_index', { name });
  },

  async storeOpen() {
    return _invoke('grove_store_open');
  },

  async storePut(storeName, value, key) {
    return _invoke('grove_store_put', { storeName, value, key });
  },

  async storeGet(storeName, key) {
    return _invoke('grove_store_get', { storeName, key });
  },

  async storeGetAll(storeName) {
    return _invoke('grove_store_get_all', { storeName });
  },

  async storeQueryByIndex(storeName, indexName, value) {
    return _invoke('grove_store_query', { storeName, indexName, value });
  },

  async getMeta(key) {
    return _invoke('grove_get_meta', { key });
  },

  async setMeta(key, value) {
    return _invoke('grove_set_meta', { key, value });
  },
};
