// chat-attach.js — the composer attachment tray. Builds the attach button, a hidden
// file input (accept=image/* → mobile shows Take Photo + Choose), and a thumbnail tray.
// Drag-drop is wired by chat.js on the composer, which calls handleFiles(). Each file is
// pre-checked (a hint) then uploaded to /verify for a signed artifact; the thumbnail is
// inert (img.src from a data: URL). Every rejection is a keyed string via onError — no
// generic failures, no silent drops.
import { strings } from '../strings.js';
import { precheckAttachment, verifyFile, acceptAttribute } from './chat-attach-core.js';

const ICON_CLIP =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.234 20.252 21 12.3"></path><path d="m16 6-8.414 8.586a2 2 0 0 0 0 2.828 2 2 0 0 0 2.828 0l8.414-8.586a4 4 0 0 0 0-5.656 4 4 0 0 0-5.656 0l-8.415 8.585a6 6 0 1 0 8.486 8.486"></path></svg>';

// Map a verify HTTP status / precheck reason to a keyed string. Named, never generic.
function _rejectString(reason) {
  switch (reason) {
    case 'too_large': case 413: return strings.chat_attach_too_large;
    case 'wrong_type': case 415: return strings.chat_attach_wrong_type;
    case 'too_many': return strings.chat_attach_too_many;
    default: return strings.chat_attach_failed;
  }
}

export function createAttachTray({ endpoint, ask, policy, secretProvider, onError, onRevoked, onPicked, committedCount = () => 0 }) {
  // The file dialog returns focus to the paperclip; left there, the next Enter reopens
  // the picker instead of sending. The caller says where focus goes back to.
  if (typeof onPicked !== 'function') throw new Error('createAttachTray: onPicked is required');
  const pending = [];
  const chips = new Map();                              // att.id → its thumbnail chip

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-attach';
  button.innerHTML = ICON_CLIP;                         // static trusted icon
  button.setAttribute('aria-label', strings.chat_attach);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = acceptAttribute(policy);               // the ask's vocabulary; mobile: Take Photo OR Choose
  input.multiple = true;
  input.className = 'chat-attach-input';                // CSS: visually hidden
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;

  const tray = document.createElement('div');
  tray.className = 'chat-attach-tray';                  // empty until a thumbnail lands

  button.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; onPicked(); });
  input.addEventListener('cancel', () => onPicked());   // dialog dismissed: same hand-back

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
      chips.delete(att.id);
      chip.remove();
    });
    chip.append(img, rm);
    tray.appendChild(chip);
    chips.set(att.id, chip);
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
        if (err && err.status === 401) { onRevoked(); return; }   // not "try again": the code is gone
        onError(_rejectString(err && err.status));
        continue;
      }
      if (pending.some((p) => p.id === att.id)) continue;   // content-addressed dedupe
      pending.push(att);
      _renderThumb(att);
    }
  }

  // A committed turn owns exactly the images it sent. Anything attached since (the
  // paperclip and page-drop stay live mid-turn) stays pending for the next turn.
  function release(sent) {
    for (const a of sent) {
      const i = pending.findIndex((p) => p.id === a.id);
      if (i >= 0) pending.splice(i, 1);
      const chip = chips.get(a.id);
      if (chip) { chip.remove(); chips.delete(a.id); }
    }
  }

  return { button, tray, input,
           handleFiles,
           pending: () => pending.slice(),
           currentCount: () => pending.length,
           release };
}
