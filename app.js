// app.js — Entry: detect mode, register transport, init router + subsystems.
//
// Mode detection (one decision point):
//   Dev:         <meta name="grove-env" content="dev"> → dev transport, pushState
//   Encrypted:   gate detects encryption → bundle transport, hash
//   Local-first: manifest.json exists → web transport, pushState
//   MPA:         no manifest.json → web transport, no client routing
//
// The manifest is the declaration. Its presence and encrypted flag
// determine the routing strategy. No client-side configuration.

import { registerTransport, loadPage as transportLoadPage } from './transport.js';
import { storeOpen, getMeta, setMeta, storePut } from './transport.js';
import { getBasePath } from './base-path.js';
import { applyStoredTheme, toggleTheme } from './theme.js';
import { init as initA11y } from './a11y.js';
import { init as initMarkdown } from './markdown.js';
import { init as initSearch } from './components/search.js';
import { init as initSidebar } from './components/sidebar.js';
import { init as initInteractions } from './interactions.js';
import { init as initGate } from './components/gate.js';
import { prefetchEncryptedAssets } from './asset-decrypt.js';
import { init as initIndexer } from './indexer.js';
import { init as initFeed } from './feed.js';
import { createRouter } from './router/router.js';
import { createPushStateStrategy } from './router/strategies/pushstate.js';
import { createHashStrategy } from './router/strategies/hash.js';
import { registerNavigation, start as startNavigation, navigate, currentRoute } from './navigation.js';

// --- Transport registration ---

async function _registerShell() {
  if (window.__TAURI__) {
    const { tauriTransport } = await import('./shell-tauri/transport.js');
    registerTransport(tauriTransport);
  } else {
    const { webTransport } = await import('./shell-web/transport.js');
    registerTransport(webTransport);
  }
}

// --- Theme: before paint ---

applyStoredTheme();

// --- Boot ---

document.addEventListener('DOMContentLoaded', async () => {
  const basePath = getBasePath();

  // 1. Dev mode
  const envMeta = document.querySelector('meta[name="grove-env"]');
  if (envMeta && envMeta.content === 'dev') {
    const { devTransport } = await import('./transport/dev.js');
    registerTransport(devTransport);
    _initNavigation('pushState', basePath);
    _initSubsystems();
    startNavigation();
    _initHMR();
    return;
  }

  // 2. Encrypted grove — gate handles transport + initial content
  const isEncrypted = await initGate({
    onUnlock: async () => {
      // Bundle transport is already registered by gate.js.
      // getBundleEntry provides metadata for the router's onBeforeNavigate.
      const bt = await import('./bundle-transport.js');
      _initNavigation('hash', basePath, null, bt.getBundleEntry);
      _initSubsystems();
      startNavigation();
      _registerSW(basePath);

      // Pre-fetch all encrypted assets in background so the SW caches
      // them for offline use. Waits for SW to be controlling so fetches
      // go through its cache-first handler. Non-blocking — page is
      // already interactive.
      const manifest = bt.getAssetManifest();
      if (manifest && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(() => {
          prefetchEncryptedAssets(manifest, basePath).catch(() => {});
        });
      }
    },
  });
  if (isEncrypted) return;

  // 3. Not dev, not encrypted — register shell transport
  await _registerShell();

  // 4. Check for manifest → local-first or MPA
  try {
    const res = await fetch(basePath + '/manifest.json', { cache: 'no-cache' });
    if (res.ok) {
      const manifest = await res.json();

      // Skeleton cards while priority-0 downloads (fallback if not server-rendered)
      const main = document.getElementById('main');
      if (main && main.children.length === 0) {
        _renderSkeletonCards(manifest, basePath);
      }

      // Fetch priority-0 blobs (index page), then start navigation
      const remaining = await _bootstrapPriority0(manifest, basePath);
      _initNavigation('pushState', basePath, manifest);
      _initSubsystems();
      startNavigation();
      _registerSW(basePath);
      _initBackground();

      // Priority-1/2 blobs + asset prefetch continue in background
      _bootstrapRemaining(remaining, manifest, basePath).catch(() => {});

      if (manifest.assets && manifest.assets.length > 0 && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(() => {
          _prefetchAssets(manifest.assets, basePath).catch(() => {});
        });
      }
    } else {
      // No manifest → MPA mode. No client routing.
      _initSubsystems();
      _registerSW(basePath);
      _initBackground();
    }
  } catch (err) {
    console.error('[grove] Bootstrap failed:', err);
    document.getElementById('main').innerHTML =
      '<div class="grove-error"><h1>Unable to load</h1>' +
      '<p>The grove could not be loaded. Check your connection and reload.</p></div>';
  }
});

// --- Router factory ---

function _initNavigation(mode, basePath, manifest, getEntryFn) {
  const strategy = mode === 'hash'
    ? createHashStrategy(basePath)
    : createPushStateStrategy(basePath);

  // Metadata lookup: manifest for local-first, getBundleEntry for encrypted.
  // Same call shape — both return { title, layout, theme } for a route.
  let lookupEntry = null;
  if (manifest) {
    lookupEntry = (route) => manifest.entries.find(e => e.route === route) || null;
  } else if (getEntryFn) {
    lookupEntry = getEntryFn;
  }

  const router = createRouter({
    strategy,
    basePath,
    loadPage: (route) => transportLoadPage(route),
    onBeforeNavigate: lookupEntry ? (route) => {
      const entry = lookupEntry(route);
      if (entry) {
        if (entry.title) document.title = entry.title;
        if (entry.layout) document.body.dataset.layout = entry.layout;
      }
    } : undefined,
  });

  registerNavigation(router);
}

// --- Skeleton cards ---

function _renderSkeletonCards(manifest, basePath) {
  const posts = manifest.entries.filter(e => e.type === 'post');
  const count = Math.min(posts.length, 24);
  if (count === 0) return;

  let cards = '';
  for (let i = 0; i < count; i++) {
    const staggerIndex = Math.min(i, 8);
    cards += `<article class="card card-skeleton" style="--stagger-index: ${staggerIndex}">
    <div class="skeleton-bar skeleton-date"></div>
    <div class="skeleton-bar skeleton-title"></div>
    <div class="skeleton-bar skeleton-excerpt"></div>
    <div class="skeleton-bar skeleton-excerpt skeleton-short"></div>
</article>\n`;
  }

  const main = document.getElementById('main');
  if (main) main.innerHTML = `<div class="feed-grid">\n${cards}</div>`;
}

// --- Bootstrap ---

async function _bootstrapPriority0(manifest, basePath) {
  await storeOpen();

  const storedVersion = await getMeta('manifest_version');
  if (storedVersion === manifest.version) return;

  const byPriority = { 0: [], 1: [], 2: [] };
  for (const entry of manifest.entries) {
    const p = Math.min(Math.max(entry.priority ?? 2, 0), 2);
    byPriority[p].push(entry);
  }

  await _fetchBlobs(byPriority[0], basePath);

  // Return remaining priorities for background fetch
  return { byPriority, needsVersion: true };
}

async function _bootstrapRemaining(remaining, manifest, basePath) {
  if (!remaining) return;

  await _fetchBlobs(remaining.byPriority[1], basePath);
  await _fetchBlobs(remaining.byPriority[2], basePath);

  if (remaining.needsVersion) {
    await setMeta('manifest_version', manifest.version);
  }
}

async function _fetchBlobs(entries, basePath) {
  const BATCH = 6;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    await Promise.all(batch.map(async (entry) => {
      try {
        const res = await fetch(basePath + '/blobs/' + entry.blob);
        if (!res.ok) return;
        const html = await res.text();
        await storePut('content', {
          route: entry.route, html,
          blob_hash: entry.hash, priority: entry.priority,
          section: entry.section || '', tags: entry.tags || [],
          title: entry.title || '', excerpt: entry.excerpt || '',
          date: entry.date || '',
        });
      } catch { /* skip failed blob */ }
    }));
  }
}

// --- Asset prefetch ---

async function _prefetchAssets(assets, basePath) {
  const BATCH = 4;
  for (let i = 0; i < assets.length; i += BATCH) {
    const batch = assets.slice(i, i + BATCH);
    await Promise.all(batch.map(async (asset) => {
      try {
        await fetch(basePath + '/' + asset.path);
      } catch {
        // Non-fatal — asset will be fetched on-demand when the page renders
      }
    }));
  }
}

// --- Subsystems ---

function _initSubsystems() {
  if (document.body.dataset.layout === 'gate') {
    document.body.dataset.layout = 'index';
  }

  initA11y();
  initMarkdown();
  initSearch();
  initSidebar();
  initInteractions();

  const themeToggle = document.querySelector('[data-action="toggle-theme"]');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const newTheme = toggleTheme();
      themeToggle.setAttribute('aria-label',
        'Switch to ' + (newTheme === 'dark' ? 'light' : 'dark') + ' theme');
    });
  }

  const clearBtn = document.querySelector('[data-action="clear-site"]');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      _clearSite(clearBtn.dataset.onClear);
    });
  }
}

// --- HMR (dev only) ---

function _initHMR() {
  const es = new EventSource('/events');
  es.onmessage = (e) => {
    if (e.data === 'content') {
      navigate(currentRoute());
    } else if (e.data === 'config') {
      location.reload();
    }
  };
}

// --- Clear site — wipe all browser state ---

async function _clearSite(onClear) {
  if (!onClear) throw new Error('data-on-clear attribute missing from clear-site button');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) { console.warn('[grove] SW unregister:', e); }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch (e) { console.warn('[grove] cache clear:', e); }
  try { localStorage.clear(); } catch (e) { /* storage unavailable */ }
  try { sessionStorage.clear(); } catch (e) { /* storage unavailable */ }
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      dbs.forEach(db => indexedDB.deleteDatabase(db.name));
    }
  } catch (e) { console.warn('[grove] IndexedDB clear:', e); }
  if (onClear === 'reload') {
    // Navigate to root — after a full wipe, only priority-0 content
    // (index page) will be available on first bootstrap. Reloading the
    // current deep URL would show "Content not available" until
    // background blob fetch completes.
    const base = document.querySelector('meta[name="grove-base-path"]');
    location.replace((base ? base.content : '') + '/');
  } else {
    location.replace(onClear);
  }
}

// --- SW + background tasks ---

function _registerSW(basePath) {
  if (!window.__TAURI__ && 'serviceWorker' in navigator) {
    // If load already fired (e.g., called from onUnlock after user interaction),
    // register immediately. Otherwise defer to load to avoid competing with
    // page resource loading.
    if (document.readyState === 'complete') {
      navigator.serviceWorker.register(basePath + '/sw.js', { scope: basePath + '/' });
    } else {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register(basePath + '/sw.js', { scope: basePath + '/' });
      });
    }
  }
}

function _initBackground() {
  storeOpen().then(() => {
    initIndexer();
    initFeed();
  });
}
