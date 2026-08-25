// chat-attach.js — the composer attachment tray. Builds the attach button, a hidden
// file input (accept=image/* → mobile shows Take Photo + Choose), and a thumbnail tray.
// Drag-drop is wired by chat.js on the composer, which calls handleFiles(). Each file is
// pre-checked (a hint) then uploaded to /verify for a signed artifact; the thumbnail is
// inert (img.src from a data: URL). Every rejection is a keyed string via onError — no
// generic failures, no silent drops.
import { strings } from '../strings.js';
import { precheckAttachment, verifyFile } from './chat-attach-core.js';

const ICON_CLIP =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3 3 0 0 1 4.5 4.5l-8.6 8.5a1 1 0 0 1-1.4-1.4l7.9-7.9"></path></svg>';

// Map a verify HTTP status / precheck reason to a keyed string. Named, never generic.
function _rejectString(reason) {
  switch (reason) {
    case 'too_large': case 413: return strings.chat_attach_too_large;
    case 'wrong_type': case 415: return strings.chat_attach_wrong_type;
    case 'too_many': return strings.chat_attach_too_many;
    default: return strings.chat_attach_failed;
  }
}

export function createAttachTray({ endpoint, ask, policy, secretProvider, onError, committedCount = () => 0 }) {
  const pending = [];

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-attach';
  button.innerHTML = ICON_CLIP;                         // static trusted icon
  button.setAttribute('aria-label', strings.chat_attach);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';                             // mobile: Take Photo OR Choose
  input.multiple = true;
  input.className = 'chat-attach-input';                // CSS: visually hidden
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;

  const tray = document.createElement('div');
  tray.className = 'chat-attach-tray';                  // empty until a thumbnail lands

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });

  function _renderThumb(att) {
    const chip = document.createElement('div');
    chip.className = 'chat-attach-thumb';
    const img = document.createElement('img');
    img.src = 'data:' + att.media_type + ';base64,' + att.data;   // inert
    img.alt = '';
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'chat-attach-remove';
    rm.setAttribute('aria-label', strings.chat_attach_remove);
    rm.textContent = '×';                                     // ×, inert
    rm.addEventListener('click', () => {
      const i = pending.indexOf(att);
      if (i >= 0) pending.splice(i, 1);
      chip.remove();
    });
    chip.append(img, rm);
    tray.appendChild(chip);
  }

  async function handleFiles(fileList) {
    for (const file of Array.from(fileList || [])) {
      const reason = precheckAttachment(file, policy, committedCount() + pending.length);
      if (reason) { onError(_rejectString(reason)); continue; }
      let att;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        att = await verifyFile({ endpoint, ask, bytes, mediaType: file.type,
                                 secret: secretProvider(), fetchImpl: fetch });
      } catch (err) {
        console.warn('[chat] attachment verify failed', err);
        onError(_rejectString(err && err.status));
        continue;
      }
      if (pending.some((p) => p.id === att.id)) continue;   // content-addressed dedupe
      pending.push(att);
      _renderThumb(att);
    }
  }

  function reset() { pending.length = 0; tray.replaceChildren(); }

  return { button, tray, input,
           handleFiles,
           pending: () => pending.slice(),
           currentCount: () => pending.length,
           reset };
}
