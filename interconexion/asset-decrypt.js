// asset-decrypt.js — Decrypt .enc assets and rewrite content media to blob URLs.
//
// For encrypted decks: walks slide content, finds media references, fetches
// the .enc envelope for each, decrypts client-side, creates blob URLs.
// Called BEFORE the renderer touches the content — the browser never sees
// .enc paths, only blob URLs.

import { b64ToBytes, deriveKey } from './decrypt-runtime.js?v=1779983983';

const _EXT_TO_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.html': 'text/html',
};

function _mimeFromPath(path) {
  const dot = path.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = path.slice(dot);
  return _EXT_TO_MIME[ext] || 'application/octet-stream';
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
    if (!res.ok) return null;
    const envelope = await res.json();
    const key = await _getOrDeriveKey(mnemonic, envelope.salt);
    const iv = b64ToBytes(envelope.iv);
    const ct = b64ToBytes(envelope.payload);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new Uint8Array(plaintext);
  } catch (err) {
    console.error(`[deck-asset-decrypt] failed: ${encUrl}`, err);
    return null;
  }
}

/**
 * Walk all slides in decrypted content data and rewrite media paths
 * from server paths to blob: URLs backed by decrypted bytes.
 *
 * Mutates contentData.slides in place. Must be called BEFORE rendering.
 *
 * @param {object} contentData - Decrypted deck content (with slides array)
 * @param {string} mnemonic - Decryption mnemonic
 */
export async function resolveEncryptedMedia(contentData, mnemonic) {
  const paths = _collectMediaPaths(contentData);
  if (paths.length === 0) return;

  // Deduplicate — same image may appear on multiple slides
  const unique = [...new Set(paths)];

  // Decrypt all in parallel, build path → blobUrl map
  const resolved = new Map();
  await Promise.all(unique.map(async (mediaPath) => {
    const encUrl = `./data/${mediaPath}.enc`;
    const bytes = await _decryptAsset(encUrl, mnemonic);
    if (!bytes) return;
    const mime = _mimeFromPath(mediaPath);
    const blob = new Blob([bytes], { type: mime });
    resolved.set(mediaPath, URL.createObjectURL(blob));
  }));

  // Rewrite all media paths in the content data to blob URLs
  _rewriteMedia(contentData, resolved);
}

function _collectMediaPaths(contentData) {
  const paths = [];
  for (const slide of (contentData.slides || [])) {
    _extractFromContent(slide.content, paths);
    _extractFromContent(slide.left?.content, paths);
    _extractFromContent(slide.right?.content, paths);
    for (const cell of (slide.cells || [])) {
      _extractFromContent(cell.content, paths);
    }
    // Split-stack panels
    for (const panel of (slide.panels || [])) {
      _extractFromContent(panel.content, paths);
    }
  }
  return paths;
}

function _extractFromContent(content, paths) {
  if (!content) return;
  const media = content.media;
  if (typeof media === 'string' && media) paths.push(media);
  else if (media && typeof media === 'object' && media.src) paths.push(media.src);
}

function _rewriteMedia(contentData, resolved) {
  for (const slide of (contentData.slides || [])) {
    _rewriteContent(slide.content, resolved);
    _rewriteContent(slide.left?.content, resolved);
    _rewriteContent(slide.right?.content, resolved);
    for (const cell of (slide.cells || [])) {
      _rewriteContent(cell.content, resolved);
    }
    for (const panel of (slide.panels || [])) {
      _rewriteContent(panel.content, resolved);
    }
  }
}

function _rewriteContent(content, resolved) {
  if (!content) return;
  const media = content.media;
  if (typeof media === 'string' && resolved.has(media)) {
    content.media = resolved.get(media);
  } else if (media && typeof media === 'object' && media.src && resolved.has(media.src)) {
    media.src = resolved.get(media.src);
  }
}
