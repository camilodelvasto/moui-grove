/**Service worker — declaration-based scope isolation for grove.
 *
 * Every shape declares its owned surface via four arrays, injected at build
 * time by the shape's build.py. The SW only intercepts within these
 * declarations. No shape's SW knows or cares about any other shape's routes.
 *
 * BUILD_VERSION and all declaration sentinels are overwritten at build time.
 * In dev (localhost) the app.js SW cleanup path unregisters any SW before
 * this file runs.
 */

const BUILD_VERSION = '0d35551933df';
const CACHE_STATIC = `grove-static-${BUILD_VERSION}`;
const CACHE_PAGES = `grove-pages-${BUILD_VERSION}`;
const CACHE_BLOBS = `grove-blobs-${BUILD_VERSION}`;

// Derive base path from SW location. SW lives at <base>/sw.js.
const BASE_PATH = self.location.pathname.replace(/\/sw\.js$/, '');

// --- Declarations — build-injected, sentinel = empty array ---

// Static assets present only for some grove types (the local-first
// manifest.json). Build-injected from what the build actually emitted, so the
// precache never lists a file that would 404. Precaching is atomic (addAll);
// a single missing asset would fail the whole SW install.
const OPTIONAL_STATIC_ASSETS = [];

const STATIC_ASSETS = [
  BASE_PATH + '/style.css',
  BASE_PATH + '/elements.css',
  BASE_PATH + '/transitions.css',
  BASE_PATH + '/app.js',
  BASE_PATH + '/decrypt-runtime.js',
  BASE_PATH + '/theme/favicon.svg',
  BASE_PATH + '/theme/favicon.ico',
  BASE_PATH + '/theme/apple-touch-icon.png',
  ...OPTIONAL_STATIC_ASSETS.map(p => BASE_PATH + p),
];

// Pages enumerable at build time — network-first, serve cached if offline.
const OWNED_PAGES = ["/", "/archive/", "/audiencias/", "/comienza-aqui/", "/condiciones-de-uso/", "/estratega/", "/flexible/"];

// SPA entry points with client-side routing — grove is multi-page, not SPA.
const OWNED_SPA_ROOTS = ["/estratega", "/flexible", "/audiencias"];

// In-scope but network-only — feeds, indexes, search.
const OWNED_DYNAMIC_PATHS = ["/feed.xml", "/feed.json", "/sitemap.xml", "/search-index.json", "/first-load-index.json"];

// Assets intercepted for runtime processing (encrypted image decryption).
const OWNED_ASSETS = ["/assets/capibara.png", "/assets/capibara-480w.webp", "/assets/capibara-480w.png", "/assets/condor.png", "/assets/condor-480w.webp", "/assets/condor-480w.png", "/assets/jaguar.png", "/assets/jaguar-480w.webp", "/assets/jaguar-480w.png", "/assets/moui-fire-logo.webp", "/assets/og.png", "/assets/og-480w.webp", "/assets/og-480w.png"];

// Sibling shape paths on the same domain — never intercept these.
// Build-injected from infrastructure/targets/ scan.
const SIBLING_PATHS = [];

// --- Computed sets for O(1) lookup in fetch handler ---
const _STATIC_SET = new Set(STATIC_ASSETS);
const _PAGES_SET = new Set(OWNED_PAGES.map(p => BASE_PATH + p));
const _DYNAMIC_SET = new Set(OWNED_DYNAMIC_PATHS.map(p => BASE_PATH + p));
const _ASSET_SET = new Set(OWNED_ASSETS.map(p => BASE_PATH + p));
const _SIBLING_PREFIXES = SIBLING_PATHS.map(p => BASE_PATH + p);

// --- Encrypted asset support ---
// Gate sends mnemonic after unlock. SW derives key once (shared salt),
// then decrypts each .enc asset with fast AES-GCM on fetch.
let _mnemonic = null;
let _derivedKey = null;

self.addEventListener('message', (e) => {
  if (e.data?.type === 'set-mnemonic') {
    _mnemonic = e.data.mnemonic;
    _derivedKey = null;
    e.source.postMessage({ type: 'mnemonic-ack' });
  }
});

self.addEventListener('install', (e) => {
  // {cache: 'reload'} bypasses the HTTP cache while precaching, so CDN
  // edge caches or stale browser cache entries can't pin yesterday's
  // bytes into today's brand-new SW cache namespace.
  e.waitUntil(
    Promise.all([
      caches.open(CACHE_STATIC).then(cache =>
        cache.addAll(STATIC_ASSETS.map(u => new Request(u, { cache: 'reload' })))
      ),
      // Precache the root page so offline works on first visit.
      caches.open(CACHE_PAGES).then(cache =>
        cache.add(new Request(BASE_PATH + '/', { cache: 'reload' }))
      ),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  // Purge old grove caches only — leave caches from other shapes untouched.
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k.startsWith('grove-') && k !== CACHE_STATIC && k !== CACHE_PAGES && k !== CACHE_BLOBS)
        .map(k => {
          console.log(`[grove-sw] purging old cache: ${k}`);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// --- SPA root helpers (encrypted groves) ---

// Returns the subtree page to serve (the owned prefix) for a navigation under
// a client-routed root, or null. Chat subtrees: a slug under /estratega/ serves
// /estratega/. Encrypted groves (root '/') serve the grove root, unchanged.
function _matchesSpaRoot(pathname) {
  for (const root of OWNED_SPA_ROOTS) {
    const abs = BASE_PATH + root;
    const prefix = abs.endsWith('/') ? abs : abs + '/';
    if (pathname === abs || pathname === prefix || pathname.startsWith(prefix)) {
      return prefix;
    }
  }
  return null;
}

// --- Fetch handler — declaration-gated ---

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const pathname = url.pathname;

  // 1. Precached static asset? → cache-first
  if (_STATIC_SET.has(pathname)) {
    e.respondWith(_cacheFirst(e.request, CACHE_STATIC));
    return;
  }

  // 2. Blobs + encrypted assets — cache-first, content-addressed (immutable by name)
  if (pathname.startsWith(BASE_PATH + '/blobs/') || pathname.endsWith('.enc')) {
    e.respondWith(_cacheFirst(e.request, CACHE_BLOBS));
    return;
  }

  // 3. Owned asset? Decrypt if mnemonic set, otherwise cache-first.
  if (_ASSET_SET.has(pathname)) {
    if (_mnemonic) {
      e.respondWith(_decryptAndRespond(e.request));
    } else {
      e.respondWith(_cacheFirst(e.request, CACHE_STATIC));
    }
    return;
  }

  // 3. Dynamic path? → pass through to network, never cache
  if (_DYNAMIC_SET.has(pathname)) {
    return;
  }

  // 4. Sibling shape's path? → not ours, pass through.
  //    Must come before owned-page and SPA checks so we never intercept
  //    another shape's routes, even when our SPA root is '/'.
  if (e.request.mode === 'navigate' &&
      _SIBLING_PREFIXES.some(p => pathname.startsWith(p))) {
    return;
  }

  // 5. Navigation to owned page? → network-first, serve cached if offline
  if (e.request.mode === 'navigate' && _PAGES_SET.has(pathname)) {
    e.respondWith(_networkFirst(e.request, CACHE_PAGES));
    return;
  }

  // 6. Navigation under a client-routed root? → serve that root's own page.
  //    Chat subtrees: a conversation slug under /estratega/ has no static file;
  //    serving /estratega/ mounts the chat, which restores the conversation
  //    from IndexedDB by slug. Encrypted groves use root '/', so this serves
  //    the grove root exactly as before. Siblings already excluded in step 4.
  if (e.request.mode === 'navigate') {
    const spaPage = _matchesSpaRoot(pathname);
    if (spaPage) {
      e.respondWith(_networkFirst(new Request(spaPage), CACHE_PAGES));
      return;
    }
  }

  // 7. Not declared → pass through. Not ours.
});

// --- Crypto helpers ---

function _b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function _deriveAssetKey(mnemonic, saltB64) {
  const salt = _b64ToBytes(saltB64);
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey(
    'raw', enc.encode(mnemonic), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

const _EXT_TO_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
};

function _mimeFromPath(pathname) {
  const dot = pathname.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = pathname.slice(dot);
  return _EXT_TO_MIME[ext] || 'application/octet-stream';
}

async function _decryptAndRespond(request) {
  const url = new URL(request.url);
  const encUrl = url.href + '.enc';

  const res = await fetch(encUrl);
  if (!res.ok) {
    console.error(`[grove-sw] encrypted asset not found: ${url.pathname}.enc (${res.status})`);
    return new Response('Encrypted asset not found', { status: 404 });
  }

  try {
    const envelope = await res.json();
    if (!_derivedKey) {
      _derivedKey = await _deriveAssetKey(_mnemonic, envelope.salt);
    }
    const iv = _b64ToBytes(envelope.iv);
    const ct = _b64ToBytes(envelope.payload);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, _derivedKey, ct
    );
    const mime = _mimeFromPath(url.pathname);
    return new Response(plaintext, {
      status: 200,
      headers: { 'Content-Type': mime },
    });
  } catch (err) {
    console.error(`[grove-sw] decrypt failed: ${url.pathname}`, err);
    return new Response(`Decryption failed: ${err.message}`, { status: 500 });
  }
}

// --- Cache strategies ---

async function _cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function _networkFirst(request, cacheName) {
  try {
    // Bypass HTTP cache — same as install precache. Without this, the
    // browser's cache can serve a stale page to the SW, which then
    // re-caches it as "fresh" and serves it until storage is cleared.
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Navigation offline with nothing cached — serve the precached root
    // page rather than throwing (which gives Chrome's dinosaur page).
    if (request.mode === 'navigate') {
      const root = await caches.match(BASE_PATH + '/');
      if (root) return root;
    }
    throw e;
  }
}
