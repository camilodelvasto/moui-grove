/**Whole-grove encryption gate.
 *
 * Detects <meta name="grove-encrypted" content="bundle"> in <head>.
 * Fetches bundle.enc, prompts for mnemonic, decrypts, registers bundle
 * transport, then calls onUnlock so the app can boot normally.
 *
 * Session persistence: mnemonic in sessionStorage survives SPA navigation
 * and same-tab reloads. Closing the tab clears it.
 */
import { decryptContent } from '../decrypt-runtime.js';
import { initBundleTransport, bundleTransport, setBundleMnemonic } from '../bundle-transport.js';
import { registerTransport } from '../transport.js';
import { createInput } from '../elements/input.js';
import { createButton } from '../elements/button.js';
import { strings } from '../app.js';
import { getBasePath } from '../base-path.js';

const SESSION_KEY = 'grove-mnemonic';

function _extractAccessHash() {
  const hash = window.location.hash;
  if (!hash) return null;
  const match = hash.match(/[#&]access=([^&]+)/);
  if (!match) return null;
  try {
    // base64url → base64 → decode
    let b64 = match[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return atob(b64);
  } catch {
    return null;
  }
}

async function _sendMnemonicToSW(mnemonic) {
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      navigator.serviceWorker.removeEventListener('message', handler);
      console.error('[grove-gate] SW mnemonic-ack timeout — images may not decrypt');
      resolve(); // proceed with unlock; images will fail visibly, not silently hang
    }, 3000);

    function handler(e) {
      if (e.data?.type === 'mnemonic-ack') {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('message', handler);
        resolve();
      }
    }
    navigator.serviceWorker.addEventListener('message', handler);
    sw.postMessage({ type: 'set-mnemonic', mnemonic });
  });
}

/**
 * Initialize the gate. Returns true if this is an encrypted grove
 * (caller should NOT register shell transport or boot until onUnlock fires).
 * Returns false if plain grove — caller proceeds normally.
 */
export async function init({ onUnlock } = {}) {
  const meta = document.querySelector('meta[name="grove-encrypted"][content="bundle"]');
  if (!meta) return false;

  const basePath = getBasePath();
  const res = await fetch(`${basePath}/bundle.enc`);
  if (!res.ok) throw new Error(`Failed to fetch bundle: ${res.status}`);
  const envelope = JSON.parse(await res.text());

  // Try stored mnemonic — silent unlock on reload / SPA return
  const stored = sessionStorage.getItem(SESSION_KEY);
  if (stored) {
    try {
      const decrypted = await decryptContent(envelope, stored);
      await _sendMnemonicToSW(stored);
      _activate(decrypted, stored, onUnlock);
      return true;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
    }
  }

  // Try #access= hash — base64url-encoded mnemonic in URL fragment.
  // Strip it from the URL after use so it doesn't persist in history.
  const hashMnemonic = _extractAccessHash();
  if (hashMnemonic) {
    try {
      const decrypted = await decryptContent(envelope, hashMnemonic);
      sessionStorage.setItem(SESSION_KEY, hashMnemonic);
      await _sendMnemonicToSW(hashMnemonic);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      _activate(decrypted, hashMnemonic, onUnlock);
      return true;
    } catch {
      // Bad access token — fall through to gate UI
    }
  }

  // Render gate UI
  const gate = document.getElementById('grove-gate');
  if (!gate) throw new Error('No #grove-gate container in gate page');

  _renderGate(gate, envelope, onUnlock);
  return true;
}

function _activate(decryptedBundle, mnemonic, onUnlock) {
  initBundleTransport(decryptedBundle);
  setBundleMnemonic(mnemonic);
  registerTransport(bundleTransport);
  if (onUnlock) onUnlock();
}

function _renderGate(container, envelope, onUnlock) {
  const siteTitle = envelope.meta?.title || 'Protected site';

  const heading = document.createElement('h1');
  heading.textContent = siteTitle;

  const subtitle = document.createElement('p');
  subtitle.textContent = strings.gate_subtitle || 'This site is private. Enter the access code to continue.';
  subtitle.className = 'gate-subtitle';

  const form = document.createElement('form');
  form.autocomplete = 'off';
  form.className = 'gate-form';

  const inputGroup = createInput({
    label: strings.gate_label || 'Access code',
    type: 'password',
    name: 'mnemonic',
    required: true,
  });
  form.appendChild(inputGroup);

  // Error text — always present, visibility-toggled. No layout shift.
  const error = document.createElement('p');
  error.className = 'gate-error';
  error.textContent = '\u00A0';
  error.setAttribute('role', 'status');
  form.appendChild(error);

  const btn = createButton({ label: strings.gate_submit || 'Unlock', type: 'submit' });
  form.appendChild(btn);

  container.appendChild(heading);
  container.appendChild(subtitle);
  container.appendChild(form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input[name="mnemonic"]');
    const mnemonic = input.value.trim();
    if (!mnemonic) return;

    try {
      const decrypted = await decryptContent(envelope, mnemonic);
      sessionStorage.setItem(SESSION_KEY, mnemonic);
      await _sendMnemonicToSW(mnemonic);
      _activate(decrypted, mnemonic, onUnlock);
    } catch (err) {
      console.error('Gate decrypt failed:', err);
      error.textContent = strings.gate_error || 'Wrong access code — try again.';
      error.classList.add('gate-error--visible');
      input.value = '';
      input.focus();
    }
  });

  const input = form.querySelector('input[name="mnemonic"]');
  if (input) input.focus();
}
