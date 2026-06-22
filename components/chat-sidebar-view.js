// chat-sidebar-view.js — pure view-model for the conversation sidebar. No DOM,
// no IndexedDB. Turns a list of records (already newest-first from the store)
// plus the active slug into the flat list the sidebar renders. Keep this module
// pure: it must run in node --test with no browser globals.

// listViewModel(records, activeSlug): map records to { slug, title, active }
// items, preserving order. Throws on a non-array (a missing list is a call-site
// bug, not something to default away). activeSlug may be null (nothing active),
// in which case no item is marked active.
export function listViewModel(records, activeSlug) {
  if (!Array.isArray(records)) throw new Error('listViewModel: records must be an array');
  return records.map((r) => ({
    slug: r.slug,
    title: r.title,
    active: activeSlug !== null && r.slug === activeSlug,
  }));
}
