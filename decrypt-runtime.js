// decrypt-runtime.js — AES-256-GCM decryption via Web Crypto.
// Shared contract between deck and grove. No UI, no DOM.

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function deriveKey(mnemonic, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', encoder.encode(mnemonic), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

export async function decryptContent(envelope, mnemonic) {
  const salt = b64ToBytes(envelope.salt);
  const iv = b64ToBytes(envelope.iv);
  const ct = b64ToBytes(envelope.payload);
  const key = await deriveKey(mnemonic, salt);
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(buf);
}
