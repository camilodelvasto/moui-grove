/**Service worker — declaration-based scope isolation for deck.
 *
 * Every shape declares its owned surface via four arrays, injected at build
 * time by the shape's build.py. The SW only intercepts within these
 * declarations. No shape's SW knows or cares about any other shape's routes.
 *
 * BUILD_VERSION and all declaration sentinels are overwritten at build time.
 * In dev (localhost) the app.js SW cleanup path unregisters any SW before
 * this file runs.
 */

const BUILD_VERSION = '1d2939e51d5f';
const LOCAL_FIRST = false;
const CACHE_NAME = `deck-static-${BUILD_VERSION}`;
const CACHE_META = 'deck-meta';

// Derive base path from SW location. SW lives at <base>/sw.js.
const BASE_PATH = self.location.pathname.replace(/\/sw\.js$/, '');

// --- Declarations — build-injected, sentinel = empty array ---

const STATIC_ASSETS = [
  BASE_PATH + '/index.html',
  BASE_PATH + '/style.css',
  BASE_PATH + '/app.js',
  BASE_PATH + '/asset-decrypt.js',
  BASE_PATH + '/renderer.js',
  BASE_PATH + '/layouts.js',
  BASE_PATH + '/theme.js',
  BASE_PATH + '/markdown.js',
  BASE_PATH + '/whiteboard.js',
  BASE_PATH + '/decrypt-runtime.js',
  BASE_PATH + '/hash-params.js',
  BASE_PATH + '/vendor/markdown-it.min.js',
  BASE_PATH + '/content.json',
  BASE_PATH + '/theme/tokens.json',
  BASE_PATH + '/theme/favicon.svg',
  BASE_PATH + '/theme/favicon.ico',
  BASE_PATH + '/theme/apple-touch-icon.png',
];

// Content-specific assets — build-injected at build time.
// Fonts, theme/style.css, media, components — varies per deck.
const PRECACHE_CONTENT = ["/fonts/fonts.css", "/fonts/fraunces/Fraunces-Variable.woff2", "/fonts/inter/Inter-Variable.woff2", "/fonts/jetbrains-mono/JetBrainsMono-Variable.woff2", "/fonts/lato/Lato-Bold.woff2", "/fonts/lato/Lato-Regular.woff2", "/fonts/montserrat/Montserrat-Variable.woff2", "/fonts/raleway/Raleway-Variable.woff2", "/theme/style.css"];

// Pages enumerable at build time — deck is SPA, uses SPA roots instead.
const OWNED_PAGES = [];

// SPA entry points — all navigations under prefix serve cached index.html.
// SPA roots must be disjoint; build rejects overlap.
const OWNED_SPA_ROOTS = ['/'];

// In-scope but network-only.
const OWNED_DYNAMIC_PATHS = [];

// Assets intercepted for runtime processing (unused — asset decryption
// is handled client-side by asset-decrypt.js, not by the SW).
const OWNED_ASSETS = [];

// --- Computed sets for O(1) lookup in fetch handler ---
const _PRECACHE_ALL = [...STATIC_ASSETS, ...PRECACHE_CONTENT.map(p => BASE_PATH + p)];
const _STATIC_SET = new Set(_PRECACHE_ALL);
const _DYNAMIC_SET = new Set(OWNED_DYNAMIC_PATHS.map(p => BASE_PATH + p));

function _matchesSpaRoot(pathname) {
  return OWNED_SPA_ROOTS.some(root => {
    const abs = BASE_PATH + root;
    const prefix = abs.endsWith('/') ? abs : abs + '/';
    return pathname === abs || pathname === prefix || pathname.startsWith(prefix);
  });
}

function _spaEntryFor(pathname) {
  for (const root of OWNED_SPA_ROOTS) {
    const abs = BASE_PATH + (root === '/' ? '/' : root);
    const prefix = abs.endsWith('/') ? abs : abs + '/';
    if (pathname === abs || pathname === prefix || pathname.startsWith(prefix)) {
      // Serve the directory URL, not /index.html — Codeberg 307-redirects
      // index.html to the directory, which causes redirect loops if the
      // cache entry is missing.
      const entry = abs.endsWith('/') ? abs : abs + '/';
      return new Request(entry);
    }
  }
}

self.addEventListener('install', (e) => {
  if (LOCAL_FIRST) {
    // Manifest-driven: fetch manifest, compare version, cache all files if changed.
    e.waitUntil(
      fetch(BASE_PATH + '/manifest.json', { cache: 'reload' })
        .then(res => res.json())
        .then(async (manifest) => {
          // Check cached version in deck-meta
          const metaCache = await caches.open(CACHE_META);
          const metaRes = await metaCache.match('version');
          const cachedVersion = metaRes ? await metaRes.text() : null;

          if (cachedVersion === manifest.version) {
            // Same version — skip precaching
            return;
          }

          // New version — cache everything
          const cache = await caches.open(CACHE_NAME);
          const urls = manifest.files.map(f => BASE_PATH + '/' + f.path);
          // Also cache static assets and SPA root
          const allUrls = [
            ..._PRECACHE_ALL,
            ...urls,
            ...OWNED_SPA_ROOTS.map(r => {
              const abs = BASE_PATH + r;
              return abs.endsWith('/') ? abs : abs + '/';
            }),
          ];
          await cache.addAll(allUrls.map(u => new Request(u, { cache: 'reload' })));

          // Store new version in deck-meta
          await metaCache.put('version', new Response(manifest.version));
        })
        .then(() => self.skipWaiting())
    );
  } else {
    // Static precache — today's behavior
    e.waitUntil(
      caches.open(CACHE_NAME).then(cache => {
        const urls = [
          ..._PRECACHE_ALL,
          ...OWNED_SPA_ROOTS.map(r => {
            const abs = BASE_PATH + r;
            return abs.endsWith('/') ? abs : abs + '/';
          }),
        ];
        return cache.addAll(urls.map(u => new Request(u, { cache: 'reload' })));
      }).then(() => self.skipWaiting())
    );
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k.startsWith('deck-') && k !== CACHE_NAME && k !== CACHE_META)
        .map(k => {
          console.log(`[deck-sw] purging old cache: ${k}`);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

// --- Fetch handler — declaration-gated ---

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  const pathname = url.pathname;

  // 1. Precached static asset? → cache-first
  if (_STATIC_SET.has(pathname)) {
    e.respondWith(_cacheFirst(e.request));
    return;
  }

  // 2. Dynamic path? → pass through to network, never cache
  if (_DYNAMIC_SET.has(pathname)) {
    return;
  }

  // 3. .enc file? → cache-first (content-addressed, immutable by name).
  //    asset-decrypt.js fetches these explicitly and decrypts client-side.
  if (pathname.endsWith('.enc')) {
    e.respondWith(_cacheFirst(e.request));
    return;
  }

  // 4. Navigation under SPA root? → serve cached entry point
  if (e.request.mode === 'navigate' && _matchesSpaRoot(pathname)) {
    e.respondWith(_cacheFirst(_spaEntryFor(pathname)));
    return;
  }

  // 5. Not declared → pass through. Not ours.
});

// --- Cache strategies ---

async function _cacheFirst(request) {
  // ignoreSearch: cache entries are stored without query params, but browser
  // requests may include ?v=<hash> cache-bust params from the HTML.
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}
