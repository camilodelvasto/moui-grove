// chat-sidebar.js — the conversation sidebar view for a persist: local chat.
//
// ONE responsibility: render this browser's conversations and emit intents. It
// owns NO state and NO truth — chat.js owns the store, the active conversation,
// and the URL. The sidebar is a dumb view over a list of records: it draws the
// list (newest-first as the store delivered it), marks the active one, and calls
// back with select/new/delete intents. chat.js does the work (restore, pushState,
// remove) and then tells the sidebar to re-render via the returned controls.
//
// Strings are content, never hardcoded: a chat-feature grove is required at build
// to provide the chat_* keys (build.py CHAT_STRING_KEYS), so we read them directly
// with no fallback. The delete confirm is composed here and handed to the shared
// modal shell (modal.js) by chat.js — the sidebar does not open dialogs itself.
import { strings } from '../strings.js';
import { listViewModel } from './chat-sidebar-view.js';

// Static, trusted icon literals — NOT untrusted model/visitor content. These are
// hardcoded SVG constants assigned via innerHTML, which is safe (no interpolation);
// this does not touch the rendering invariant, which governs model answers and
// visitor text. Minimal line icons, stroke: currentColor so they inherit text color.
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
const ICON_TRASH =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>';

// create({ onSelect, onNew, onDelete }) → { element, render }.
//
// element: the sidebar root to mount next to the chat. render(records, activeSlug):
// (re)draw the list from the records chat.js read from the store, marking the active
// slug. The three callbacks are intents — the sidebar never mutates the store or the
// URL; chat.js handles each and then calls render() again with fresh inputs.
//
//   onSelect(slug)  — visitor clicked a conversation
//   onNew()         — visitor clicked "new chat"
//   onDelete(slug)  — visitor clicked delete on a conversation
export function create({ onSelect, onNew, onDelete }) {
  if (typeof onSelect !== 'function') throw new Error('chat-sidebar: onSelect must be a function');
  if (typeof onNew !== 'function') throw new Error('chat-sidebar: onNew must be a function');
  if (typeof onDelete !== 'function') throw new Error('chat-sidebar: onDelete must be a function');

  const aside = document.createElement('aside');
  aside.className = 'chat-sidebar';
  aside.setAttribute('aria-label', strings.chat_sidebar_label);

  // A prominent, full-width "New chat" button leads the sidebar (ChatGPT/Claude cue):
  // a quiet pill with a small + icon before the (keyed) label. The icon is a trusted
  // literal; the visible text stays a string. The section label sits beneath it as a
  // small muted header over the list.
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'chat-sidebar-new';
  const newIcon = document.createElement('span');
  newIcon.className = 'chat-sidebar-new-icon';
  newIcon.innerHTML = ICON_PLUS;                          // static trusted icon, not untrusted content
  const newLabel = document.createElement('span');
  newLabel.textContent = strings.chat_new;               // keyed string, inert
  newBtn.append(newIcon, newLabel);
  newBtn.addEventListener('click', () => onNew());

  const label = document.createElement('span');
  label.className = 'chat-sidebar-label';
  label.textContent = strings.chat_sidebar_label;

  // The list is rebuilt wholesale on each render — the namespace's conversation
  // count is small and a full redraw keeps the active mark and ordering honest
  // without diffing.
  const list = document.createElement('ul');
  list.className = 'chat-sidebar-list';

  aside.append(newBtn, label, list);

  const render = (records, activeSlug) => {
    const items = listViewModel(records, activeSlug);
    list.textContent = '';
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'chat-sidebar-item' + (item.active ? ' chat-sidebar-item-active' : '');

      const select = document.createElement('button');
      select.type = 'button';
      select.className = 'chat-sidebar-select';
      select.textContent = item.title;                     // the record's title, inert
      if (item.active) select.setAttribute('aria-current', 'true');
      select.addEventListener('click', () => onSelect(item.slug));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'chat-sidebar-delete';
      del.innerHTML = ICON_TRASH;                          // static trusted icon, not untrusted content
      del.setAttribute('aria-label', strings.chat_delete); // keyed label kept for a11y
      del.addEventListener('click', () => onDelete(item.slug));

      li.append(select, del);
      list.appendChild(li);
    }
  };

  return { element: aside, render };
}

// confirmDelete(onConfirm, onCancel) → a two-button confirm node for modal.open.
// Composed here (the confirm copy belongs to the sidebar feature) but opened by
// chat.js via the shared modal shell. The buttons call the caller's handlers; the
// caller (chat.js) closes the modal and does the work, capturing values first.
export function confirmDelete(onConfirm, onCancel) {
  const node = document.createElement('div');
  node.className = 'chat-delete-confirm';

  const message = document.createElement('p');
  message.className = 'chat-delete-confirm-message';
  message.textContent = strings.chat_delete_confirm;

  const actions = document.createElement('div');
  actions.className = 'chat-delete-confirm-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'chat-delete-confirm-cancel';
  cancel.textContent = strings.chat_delete_cancel;
  cancel.addEventListener('click', () => onCancel());

  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'chat-delete-confirm-ok';
  confirm.textContent = strings.chat_delete;
  confirm.addEventListener('click', () => onConfirm());

  actions.append(cancel, confirm);
  node.append(message, actions);
  return node;
}
