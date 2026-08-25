// chat-attachments.js — the content-addressed attachment blob store. Browser-only.
// Kept SEPARATE from the conversations store (chat-idb) so the sidebar's getAll over
// records never loads image bytes: a conversation record holds attachment IDS; the
// bytes live here, keyed by sha256 (content-addressing — identical bytes, one record).
// Same namespaced DB as conversations, so origin+route scoping is identical.
//
// NO SILENT FALLBACKS: a storage failure logs loudly and degrades — getAttachments
// returns the records it could read (a missing blob → the turn renders text-only,
// never a wrong image); putAttachment reports false.
import { withStore } from './chat-idb.js';

const ATTACH_STORE = 'attachments';

// putAttachment(ns, attachment): upsert {id, data, signature, media_type}. true on
// durable commit, false on failure (logged).
export async function putAttachment(ns, attachment) {
  try {
    await withStore(ns, 'readwrite', (store) => store.put(attachment), ATTACH_STORE);
    return true;
  } catch (err) {
    console.error('chat-attachments: put failed for', ns, attachment && attachment.id, err);
    return false;
  }
}

// getAttachments(ns, ids): Map<id, attachment> for the ids present. Reads each id in one
// readonly tx. A missing id is simply absent from the map (logged so a lost blob is
// visible, never silently masked).
export async function getAttachments(ns, ids) {
  const out = new Map();
  for (const id of ids) {
    try {
      const rec = await withStore(ns, 'readonly', (store) => store.get(id), ATTACH_STORE);
      if (rec) out.set(id, rec);
      else console.error('chat-attachments: no stored blob for id', id, '(turn will render text-only)');
    } catch (err) {
      console.error('chat-attachments: get failed for', ns, id, err);
    }
  }
  return out;
}

// removeAttachments(ns, ids): best-effort delete (GC when a conversation is deleted).
export async function removeAttachments(ns, ids) {
  for (const id of ids) {
    try {
      await withStore(ns, 'readwrite', (store) => store.delete(id), ATTACH_STORE);
    } catch (err) {
      console.error('chat-attachments: remove failed for', ns, id, err);
    }
  }
}
