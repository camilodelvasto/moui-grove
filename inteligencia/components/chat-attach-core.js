// chat-attach-core.js — the non-DOM core of attachments: the client pre-check (a hint;
// the box re-enforces) and the verify upload. Kept pure/injectable (fetchImpl) so it
// runs under node --test. The DOM tray (chat-attach.js) composes these.

// precheckAttachment(file, policy, currentCount): the reason to reject BEFORE upload, or
// null. Saves a round-trip and gives instant feedback; the server is still the authority.
// `file` is {size, type} (a File satisfies it). `accept` is a coarse kind vocabulary
// ('image'), matched against the MIME type's first segment.
export function precheckAttachment(file, policy, currentCount) {
  if (typeof policy.max_bytes === 'number' && file.size > policy.max_bytes) return 'too_large';
  const kind = (file.type || '').split('/')[0];
  if (!policy.accept.includes(kind)) return 'wrong_type';
  if (typeof policy.max_count === 'number' && currentCount >= policy.max_count) return 'too_many';
  return null;
}

// base64ToBytes / bytesToBase64: browsers give us atob/btoa; both exist in node too.
export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// sha256Hex(bytes): the content address. crypto.subtle is standard in browsers and in
// modern node (globalThis.crypto.subtle), so no injection is needed.
export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// verifyFile({endpoint, ask, bytes, mediaType, secret, fetchImpl}): POST the raw image
// bytes to /verify/{ask}; return the content-addressed attachment {id, data, signature,
// media_type}. A non-OK response throws an Error carrying .status (the caller maps it to
// a keyed string). No fallback — a failed verify is never treated as a clean image.
export async function verifyFile({ endpoint, ask, bytes, mediaType, secret, fetchImpl = fetch }) {
  const url = endpoint.replace(/\/$/, '') + '/verify/' + encodeURIComponent(ask);
  const headers = { 'Content-Type': mediaType };
  if (secret) headers['Authorization'] = 'Bearer ' + secret;
  const res = await fetchImpl(url, { method: 'POST', headers, body: bytes });
  if (!res.ok) {
    const err = new Error('verify failed with status ' + res.status);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();   // { data, signature, media_type, bytes }
  const id = await sha256Hex(base64ToBytes(body.data));
  return { id, data: body.data, signature: body.signature, media_type: body.media_type };
}
