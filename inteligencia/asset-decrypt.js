// asset-decrypt.js — Decrypt .enc assets and rewrite HTML to blob URLs.
//
// Used by bundle-transport in encrypted groves. Before decrypted HTML is
// injected into the DOM, this module rewrites all image references from
// server paths to blob: URLs backed by decrypted bytes.
//
// The browser never sees .enc paths — it only sees blob URLs that resolve.

import { b64ToBytes, deriveKey } from './decrypt-runtime.js';
import { getBasePath } from './base-path.js';

const CACHE_NAME = 'grove-decrypted';

const _EXT_TO_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
};

function _mimeFromPath(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = path.slice(dot);
  return _EXT_TO_MIME[ext] || 'application/octet-stream';
}

function _encUrl(basePath, assetPath) {
  return (basePath || '') + '/' + assetPath + '.enc';
}

let _cachedKey = null;
let _cachedSalt = null;

async function _getOrDeriveKey(mnemonic, saltB64) {
  if (_cachedKey && _cachedSalt === saltB64) return _cachedKey;
  const salt = b64ToBytes(saltB64);
  _cachedKey = await deriveKey(mnemonic, salt);
  _cachedSalt = saltB64;
  return _cachedKey;
}

async function _decryptAsset(encUrl, mnemonic) {
  try {
    const res = await fetch(encUrl);
    if (!res.ok) {
      console.error(`[asset-decrypt] fetch failed: ${encUrl} (${res.status})`);
      return null;
    }
    const envelope = await res.json();
    // Use the salt from the .enc envelope itself — same approach as the SW.
    // All .enc files share one salt per build, but reading it from the
    // envelope is more robust than relying on the bundle's copy.
    const key = await _getOrDeriveKey(mnemonic, envelope.salt);
    const iv = b64ToBytes(envelope.iv);
    const ct = b64ToBytes(envelope.payload);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new Uint8Array(plaintext);
  } catch (err) {
    console.error(`[asset-decrypt] decrypt failed: ${encUrl}`, err);
    return null;
  }
}

async function _getCachedBlob(cacheKey) {
  try {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (cached) return URL.createObjectURL(await cached.blob());
  } catch {
    // Cache API unavailable (private browsing, etc.) — proceed without cache
  }
  return null;
}

/**
 * Resolve all image src attributes in an HTML string that point to assets
 * in the manifest. Fetches .enc files, decrypts, rewrites to blob URLs.
 *
 * Must be called BEFORE injecting HTML into the DOM — the browser never
 * sees .enc paths. Returns the full HTML document string (not just body
 * innerHTML) so callers don't need to re-wrap.
 *
 * @param {string} html - Full HTML document string with image references
 * @param {object} assetManifest - manifest from decrypted bundle
 * @param {string} mnemonic - decryption mnemonic
 * @param {string} assetSalt - base64-encoded shared salt from bundle
 * @returns {string} Full HTML document with image src rewritten to blob URLs
 */
export async function resolveEncryptedImages(html, assetManifest, mnemonic, assetSalt) {
  if (!assetManifest || !assetSalt) return html;

  const basePath = getBasePath();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Collect all unique asset paths that need decryption.
  // From <img src="...">, using the original (fallback) path only.
  // <source> elements are removed — encrypted groves serve one resolution.
  const images = doc.querySelectorAll('img[src]');
  const pathsToResolve = new Map(); // path -> { mime, elements: [{el, attr}] }

  for (const img of images) {
    const src = img.getAttribute('src');
    const assetPath = _stripBasePath(src, basePath);
    if (!_isManifestPath(assetPath, assetManifest)) continue;

    const mime = _mimeFromPath(assetPath);
    if (!pathsToResolve.has(assetPath)) {
      pathsToResolve.set(assetPath, { mime, elements: [] });
    }
    pathsToResolve.get(assetPath).elements.push({ el: img, attr: 'src' });
  }

  // Remove <source> elements inside <picture> — encrypted groves don't
  // serve responsive variants. The <img> fallback inside <picture> is
  // the only image source. This prevents the browser from attempting to
  // fetch srcset paths that would 404 or return garbled .enc data.
  const sources = doc.querySelectorAll('picture > source');
  for (const source of sources) source.remove();

  // Decrypt and rewrite all paths in parallel
  const resolvePromises = [];
  for (const [assetPath, info] of pathsToResolve) {
    resolvePromises.push(
      _resolveOnePath(assetPath, info, mnemonic, assetSalt, basePath)
    );
  }
  await Promise.all(resolvePromises);

  // Return full document — callers don't need to re-wrap.
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}

function _stripBasePath(src, basePath) {
  if (basePath && src.startsWith(basePath + '/')) {
    return src.slice(basePath.length + 1);
  }
  if (src.startsWith('/')) return src.slice(1);
  return src;
}

function _isManifestPath(assetPath, manifest) {
  // Manifest is keyed by source-relative path (e.g., "assets/photo.png").
  // <img src> in the rendered HTML uses the same path format.
  return assetPath in manifest;
}

async function _resolveOnePath(assetPath, info, mnemonic, assetSalt, basePath) {
  const cacheKey = `/_decrypted/${assetPath}`;

  // Check cache first
  const cachedUrl = await _getCachedBlob(cacheKey);
  if (cachedUrl) {
    for (const { el, attr } of info.elements) el.setAttribute(attr, cachedUrl);
    return;
  }

  // Fetch and decrypt
  const encUrl = _encUrl(basePath, assetPath);
  const bytes = await _decryptAsset(encUrl, mnemonic);
  if (!bytes) return; // fetch/decrypt failed — leave original src (will 404 visibly)

  // Cache by path and create blob URL
  const blob = new Blob([bytes], { type: info.mime });
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKey, new Response(blob.slice()));
  } catch { /* Cache API unavailable — blob URL still works for this session */ }
  const blobUrl = URL.createObjectURL(blob);

  for (const { el, attr } of info.elements) el.setAttribute(attr, blobUrl);
}

/**
 * Pre-fetch all encrypted assets so the SW caches them for offline use.
 * Called once after unlock. The SW's cache-first handler for .enc files
 * (sw.js line 120) caches each response automatically — this function
 * just triggers the fetches.
 *
 * Runs in background — does not block page rendering. Failures are
 * non-fatal (the asset will be fetched on-demand when the page loads).
 *
 * @param {object} assetManifest - { "assets/photo.png": {...}, ... }
 * @param {string} basePath - base URL path (e.g., "/site" or "")
 */
export async function prefetchEncryptedAssets(assetManifest, basePath) {
  if (!assetManifest) return;

  const paths = Object.keys(assetManifest);
  if (paths.length === 0) return;

  const BATCH = 4;
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH);
    await Promise.all(batch.map(async (assetPath) => {
      const encUrl = _encUrl(basePath, assetPath);
      try {
        await fetch(encUrl);
      } catch {
        // Non-fatal — asset will be fetched on-demand when the page renders
      }
    }));
  }
}

/**
 * Clear the decrypted asset cache.
 */
export async function clearDecryptedCache() {
  try {
    await caches.delete(CACHE_NAME);
  } catch { /* Cache API unavailable */ }
  _cachedKey = null;
  _cachedSalt = null;
}
