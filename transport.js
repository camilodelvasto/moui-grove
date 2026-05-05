// transport.js — Shell-agnostic transport contract.
// Shells (web, tauri) register implementations via registerTransport().
// Core modules import and call these functions without knowing which shell is active.
// Calling any function before registration throws — no silent defaults.

let _impl = null;

function _require(method) {
  if (!_impl) throw new Error('Transport not registered. Call registerTransport() from your shell before using core modules.');
  if (!_impl[method]) throw new Error(`Transport missing method: ${method}`);
  return _impl[method];
}

/** Called once by the active shell (shell-web or shell-tauri) at startup. */
export function registerTransport(impl) {
  if (_impl) throw new Error('Transport already registered.');
  const required = ['loadPage', 'fetchFeed', 'fetchPage', 'cachePage', 'getIndex', 'storeOpen', 'storePut', 'storeGet', 'storeGetAll', 'storeQueryByIndex', 'getMeta', 'setMeta'];
  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`Transport implementation missing required method: ${method}`);
    }
  }
  _impl = impl;
}

/** Fetch an HTML page by path. Returns { html } or null if not found. */
export async function loadPage(path) { return _require('loadPage')(path); }

/** Fetch the RSS feed. Returns XML string. */
export async function fetchFeed() { return _require('fetchFeed')(); }

/** Fetch an HTML page for caching. Returns Response-like { ok, url, clone, text }. */
export async function fetchPage(url) { return _require('fetchPage')(url); }

/** Cache a fetched page. No-op if caching unavailable. */
export async function cachePage(url, response) { return _require('cachePage')(url, response); }

/** Fetch a named JSON index ('first-load' or 'search'). Returns parsed array. */
export async function getIndex(name) { return _require('getIndex')(name); }

/** Initialize the data store. Must be called before any store operation. */
export async function storeOpen() { return _require('storeOpen')(); }

/** Put a record into a named store. */
export async function storePut(storeName, value, key) { return _require('storePut')(storeName, value, key); }

/** Get a record from a named store by key. */
export async function storeGet(storeName, key) { return _require('storeGet')(storeName, key); }

/** Get all records from a named store. */
export async function storeGetAll(storeName) { return _require('storeGetAll')(storeName); }

/** Query records by index. */
export async function storeQueryByIndex(storeName, indexName, value) { return _require('storeQueryByIndex')(storeName, indexName, value); }

/** Get a value from user_state store. */
export async function getMeta(key) { return _require('getMeta')(key); }

/** Set a value in user_state store. */
export async function setMeta(key, value) { return _require('setMeta')(key, value); }
