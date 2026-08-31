// chat-store.js — pure conversation data layer, no DOM, no IndexedDB.
// A conversation record is { id, title, slug, turns:[...], created, updated }.
// A turn is { role:'user', content } or { role:'assistant', content, sources } where
// `sources` is the ordered source list ([{n,title}]) the renderer computed for that
// answer — stored so a restored answer renders its numbered sources, not just markers.
// These functions are the deterministic core (slugify/dedupe/sort); the IndexedDB
// adapter (chat-idb.js) builds on top of them. Keep this module pure: it must run
// in node --test with no browser globals.

const SLUG_MAX = 60;
const SLUG_SENTINEL = 'chat'; // stable key for an unsluggable-but-valid title

// slugFor(title): NFD-normalize, strip diacritics, lowercase, non-alphanumerics → '-',
// collapse and trim hyphens, cap length. Throws on a non-string — a missing title is
// a bug at the call site, not something to paper over with a default.
//
// When the slugified result is empty (e.g. '', '!!!', '🔥', '你好' — punctuation, emoji,
// or non-Latin scripts that strip to nothing), return the sentinel 'chat' instead of ''.
// This is NOT a fallback that hides an error: a title is required (a non-string still
// throws), but a pathological-yet-present title must not crash the naming/URL flow nor
// collapse every such title onto the empty-string IDB key. We don't throw because the
// title IS present and valid input; we give it a stable non-empty key. The caller
// dedupes slugs at name time, so multiple unsluggable titles become 'chat', 'chat-<hex>'.
export function slugFor(title) {
  if (typeof title !== 'string') throw new Error('slugFor: title must be a string');
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, ''); // re-trim if the cap landed mid-hyphen
  return slug === '' ? SLUG_SENTINEL : slug;
}

// dedupeSlug(slug, takenSet): return slug if free, else append a short hex suffix
// until free. takenSet is a Set of slugs already used in the namespace.
export function dedupeSlug(slug, takenSet) {
  if (!(takenSet instanceof Set)) throw new Error('dedupeSlug: takenSet must be a Set');
  if (!takenSet.has(slug)) return slug;
  let candidate;
  do {
    candidate = slug + '-' + randomHex(4);
  } while (takenSet.has(candidate));
  return candidate;
}

// makeRecord(title, turns): build a fresh record. slug comes from slugFor(title);
// dedupe is the caller's job at name time (against the namespace's taken slugs), so
// makeRecord never reaches for a store. id is random; created === updated === now.
export function makeRecord(title, turns) {
  if (!Array.isArray(turns)) throw new Error('makeRecord: turns must be an array');
  const now = Date.now();
  return {
    id: randomHex(16),
    title,
    slug: slugFor(title),
    turns,
    created: now,
    updated: now,
  };
}

// toWireTurns(history): map in-memory turns to the endpoint's wire contract —
// EXACTLY { role, content } per turn, nothing else. The engine's _render_history
// reads only role + content; an assistant turn's `sources` is a CLIENT display
// concern (the stored numbered list) and must never ride the wire. No-fallbacks:
// we build the shape explicitly rather than trusting extra fields to be ignored.
export function toWireTurns(history) {
  if (!Array.isArray(history)) throw new Error('toWireTurns: history must be an array');
  return history.map((t) => ({ role: t.role, content: t.content }));
}

// toStoredTurns(history): map in-memory turns to the persisted shape. A user turn is
// { role, content }; an assistant turn additionally carries its `sources` ([{n,title}])
// so a restored answer renders the numbered sources list, not just the [1..n] markers.
// Sources ride along only when present — a turn captured before this change (or one
// with no citations) simply has none, and restore renders answer-only (legacy compat).
export function toStoredTurns(history) {
  if (!Array.isArray(history)) throw new Error('toStoredTurns: history must be an array');
  return history.map((t) =>
    t.role === 'assistant' && t.sources
      ? { role: t.role, content: t.content, sources: t.sources }
      : { role: t.role, content: t.content });
}

// sortByRecency(list): return a COPY sorted by `updated` descending. Does not mutate.
export function sortByRecency(list) {
  if (!Array.isArray(list)) throw new Error('sortByRecency: list must be an array');
  return [...list].sort((a, b) => b.updated - a.updated);
}

// slugFromRoute(route, base): given the active route (basePath already stripped by
// the router strategy, e.g. '/assistant/my-convo/') and the chat's base route
// (e.g. '/assistant/'), return the conversation slug — the single path segment after
// the base — or '' for the bare base route (the fresh entry state). Pure: it does no
// DOM/URL reading; the caller passes the already-normalized route from currentRoute().
//
// No-fallbacks: a route that is not under the base is a call-site bug (the caller
// must scope to the chat's subtree before asking for a slug), so we throw rather than
// guess. Both inputs are normalized to a single trailing slash for the comparison so a
// missing slash never silently changes the answer. A nested tail ('a/b/') keeps only
// the first segment — slugs are flat, and a deeper path is not a second conversation.
export function slugFromRoute(route, base) {
  if (typeof route !== 'string') throw new Error('slugFromRoute: route must be a string');
  if (typeof base !== 'string' || base === '') throw new Error('slugFromRoute: base must be a non-empty string');
  const r = route.endsWith('/') ? route : route + '/';
  const b = base.endsWith('/') ? base : base + '/';
  if (r !== b && !r.startsWith(b)) {
    throw new Error('slugFromRoute: route ' + route + ' is not under base ' + base);
  }
  const tail = r.slice(b.length).replace(/^\/+|\/+$/g, '');
  if (tail === '') return '';
  return tail.split('/')[0];
}

// randomHex(bytes): hex string, length = bytes*2. Uses crypto where available
// (browser + modern node both expose globalThis.crypto.getRandomValues).
function randomHex(bytes) {
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  let hex = '';
  for (const b of buf) hex += b.toString(16).padStart(2, '0');
  return hex;
}
