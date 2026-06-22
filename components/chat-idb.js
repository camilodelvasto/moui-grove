// chat-idb.js — IndexedDB adapter for the conversation store. Browser-only.
// The pure data logic lives in chat-store.js; this module is the storage contract:
// five async functions (openDB, list, get, put, remove) over one record store.
//
// NAMESPACING (security-relevant): the store is scoped by the chat's base ROUTE
// (e.g. '/assistant/'). The browser already origin-scopes IndexedDB, so two sites
// in one browser never cross-read. Two chatbots on one site never cross-read because
// their routes differ. There is NO grove id involved — the client cannot get one and
// doesn't need one. Namespace = the chat's base route, nothing else.
//
// NO SILENT FALLBACKS: every call is wrapped so a storage failure degrades to
// ephemeral behavior, but ALWAYS loudly via console.error. A failure must never
// surface as the wrong conversation — list/get return empty/null and shout; put/remove
// report the failure. The caller can then run in-memory for the session.

import { sortByRecency } from './chat-store.js';

const DB_PREFIX = 'grove-chat'; // one IDB database per namespace, keyed by route
const STORE = 'conversations';
const DB_VERSION = 1;

// dbNameFor(namespace): a stable, route-derived database name. The route is the only
// namespacing input; we sanitize it for the IDB name but keep it 1:1 with the route.
function dbNameFor(namespace) {
  if (typeof namespace !== 'string' || namespace === '') {
    throw new Error('chat-idb: namespace (chat route) is required');
  }
  return DB_PREFIX + ':' + namespace;
}

// openDB(namespace) → IDBDatabase handle. Creates the object store on first open.
// Records are keyed by `slug` (unique within a namespace; dedupe is enforced upstream).
export function openDB(namespace) {
  const name = dbNameFor(namespace);
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(name, DB_VERSION);
    } catch (err) {
      console.error('chat-idb: openDB failed to start for', name, err);
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'slug' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      console.error('chat-idb: openDB failed for', name, req.error);
      reject(req.error);
    };
  });
}

// Run one transaction against the store and resolve with the request's result.
//
// Correctness over speed: we resolve on TRANSACTION COMPLETION, not request success.
// For a readwrite tx a `put`/`delete` request can fire onsuccess and THEN the
// transaction aborts (QuotaExceededError, constraint violation, explicit abort) —
// nothing would have been persisted. Resolving on req.onsuccess there would report a
// write that never happened: a silent wrong outcome. So we capture req.result in
// req.onsuccess but only RESOLVE in tx.oncomplete (durability guaranteed at that
// point), and we REJECT in tx.onerror/tx.onabort (loudly) so put/remove return false.
// Reads route through the same path and are equally correct.
//
// We close the DB on settle so connections don't leak and block a future
// onupgradeneeded.
function withStore(namespace, mode, run) {
  return new Promise((resolve, reject) => {
    openDB(namespace).then((db) => {
      let tx;
      try {
        tx = db.transaction(STORE, mode);
      } catch (err) {
        console.error('chat-idb: transaction failed for', namespace, err);
        db.close();
        reject(err);
        return;
      }
      const store = tx.objectStore(STORE);
      let result; // captured from the request; only surfaced once the tx commits
      const req = run(store);
      req.onsuccess = () => { result = req.result; };
      // Note: a request-level onerror that isn't preventDefault()'d aborts the tx,
      // so tx.onabort below is the real reject path. We log here for the precise error.
      req.onerror = () => {
        console.error('chat-idb: request failed for', namespace, req.error);
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        console.error('chat-idb: transaction error for', namespace, tx.error);
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        console.error('chat-idb: transaction aborted for', namespace, tx.error);
        db.close();
        reject(tx.error);
      };
    }).catch(reject);
  });
}

// list(ns) → all records for the namespace, sorted newest-first. On any failure,
// logs loudly and returns [] so the UI degrades to "no history" rather than the
// wrong history.
export async function list(ns) {
  try {
    const all = await withStore(ns, 'readonly', (store) => store.getAll());
    return sortByRecency(all);
  } catch (err) {
    console.error('chat-idb: list failed for', ns, '— returning empty (ephemeral)', err);
    return [];
  }
}

// get(ns, slug) → one record or null. On failure, logs loudly and returns null.
export async function get(ns, slug) {
  try {
    const rec = await withStore(ns, 'readonly', (store) => store.get(slug));
    return rec === undefined ? null : rec;
  } catch (err) {
    console.error('chat-idb: get failed for', ns, slug, '— returning null (ephemeral)', err);
    return null;
  }
}

// put(ns, record) → upsert. Returns true on success, false on failure (logged loudly).
export async function put(ns, record) {
  try {
    await withStore(ns, 'readwrite', (store) => store.put(record));
    return true;
  } catch (err) {
    console.error('chat-idb: put failed for', ns, record && record.slug, '— not persisted (ephemeral)', err);
    return false;
  }
}

// remove(ns, slug) → delete. Returns true on success, false on failure (logged loudly).
export async function remove(ns, slug) {
  try {
    await withStore(ns, 'readwrite', (store) => store.delete(slug));
    return true;
  } catch (err) {
    console.error('chat-idb: remove failed for', ns, slug, '— not removed (ephemeral)', err);
    return false;
  }
}
