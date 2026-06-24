/**Search palette — queries the search index, renders results.
 *
 * Search is a command palette: an input with a live results list and keyboard
 * navigation. It owns ALL of that behavior. The dialog chrome (the `<dialog>`,
 * backdrop, focus trap, Escape-to-close, focus-restore) is NOT search's — it
 * comes from the behavior-free modal shell (`modal.js`). Search builds its
 * palette node and hands it to `modal.open(node, { onClose })`.
 *
 * Keyboard contract (driven by aria-activedescendant):
 *   ArrowDown / ArrowUp → move the active option; input keeps focus so typing
 *                         never breaks. Active option is identified by
 *                         input[aria-activedescendant], not by real focus.
 *   Enter               → navigate to the active option's href.
 *   Escape              → native dialog cancel → close (provided by the shell).
 *
 * CSS can style the current item with `.search-result[aria-selected="true"]`.
 */
import { getIndex } from '../transport.js';
import { navigate, buildHref } from '../navigation.js';
import { getBasePath } from '../base-path.js';
import { strings } from '../strings.js';
import { open as openModal } from './modal.js';
import { nextIndex } from './search-nav.js';

/** Normalize url_path to a route by stripping basePath if present. */
function _toRoute(urlPath) {
  const basePath = getBasePath();
  let route = urlPath;
  if (basePath && route.startsWith(basePath)) {
    route = route.slice(basePath.length);
  }
  if (!route.startsWith('/')) route = '/' + route;
  return route;
}

const LIST_ID = 'search-results-list';
const OPTION_ID_PREFIX = 'search-option-';

let closeModal = null;
let searchIndex = null;
let activeIndex = -1;
let currentOptions = [];
let currentInput = null;

export function init() {
  const trigger = document.querySelector('[data-action="open-search"]');
  if (!trigger) return;

  trigger.addEventListener('click', open);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      open();
    }
  });
}

function open() {
  if (closeModal) { closeModal(); return; }

  // Search builds ONLY its palette node — the input + results list and all of
  // its own behavior. The dialog, backdrop, focus trap, Escape, and focus
  // restore come from the modal shell. The shell's panel is the search-aria'd
  // region; we keep the search-* classes on our own nodes for the styling
  // already in core/style.css.
  const palette = document.createElement('div');
  palette.className = 'search-palette';
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', strings.search_aria || 'Search');

  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = strings.search_placeholder || 'Search posts...';
  input.setAttribute('aria-label', strings.search_input_aria || 'Search posts');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', LIST_ID);
  input.setAttribute('aria-autocomplete', 'list');
  input.autofocus = true;
  currentInput = input;

  const results = document.createElement('div');
  results.className = 'search-results';
  results.id = LIST_ID;
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-live', 'polite');

  palette.appendChild(input);
  palette.appendChild(results);

  input.addEventListener('input', () => _search(input.value, results));
  input.addEventListener('keydown', _handleKeydown);

  // Hand the palette to the shell. It mounts the chrome, traps focus, wires
  // Escape + backdrop, and restores focus to the trigger on close. onClose is
  // the single search-state reset.
  closeModal = openModal(palette, { onClose: _onClose });

  _loadIndex();
}

function _onClose() {
  closeModal = null;
  activeIndex = -1;
  currentOptions = [];
  currentInput = null;
}

async function _loadIndex() {
  if (searchIndex) return;
  searchIndex = await getIndex('search');
}

function _handleKeydown(e) {
  if (currentOptions.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _setActive(nextIndex(activeIndex, currentOptions.length, 'down'), { scroll: true });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _setActive(nextIndex(activeIndex, currentOptions.length, 'up'), { scroll: true });
  } else if (e.key === 'Enter') {
    if (activeIndex < 0) return;
    e.preventDefault();
    const route = currentOptions[activeIndex].dataset.route;
    closeModal();
    navigate(route);
  }
}

function _setActive(index, { scroll = false } = {}) {
  if (activeIndex >= 0 && currentOptions[activeIndex]) {
    currentOptions[activeIndex].setAttribute('aria-selected', 'false');
  }
  activeIndex = index;
  const el = currentOptions[index];
  el.setAttribute('aria-selected', 'true');
  currentInput.setAttribute('aria-activedescendant', el.id);
  // Only scroll during keyboard navigation. On mobile, `mouseenter` fires
  // synthetically before `click`; scrollIntoView during that window shifts
  // the element under the finger and the browser cancels the tap.
  if (scroll) el.scrollIntoView({ block: 'nearest' });
}

function _search(query, container) {
  container.innerHTML = '';
  currentOptions = [];
  activeIndex = -1;
  if (currentInput) currentInput.removeAttribute('aria-activedescendant');

  if (!query || query.length < 2 || !searchIndex) return;

  const terms = query.toLowerCase().split(/\s+/);
  const matches = searchIndex.filter(post => {
    const haystack = [post.title, post.excerpt, post.tokens].join(' ').toLowerCase();
    return terms.every(t => haystack.includes(t));
  });

  matches.slice(0, 10).forEach((post, i) => {
    const item = document.createElement('div');
    item.className = 'search-result';
    item.id = OPTION_ID_PREFIX + i;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', 'false');
    const route = _toRoute(post.url_path);
    item.dataset.route = route;
    item.tabIndex = -1;

    const a = document.createElement('a');
    a.href = buildHref(route);
    a.textContent = post.title;

    const p = document.createElement('p');
    p.className = 'excerpt';
    if (post.excerpt) p.textContent = post.excerpt;

    item.appendChild(a);
    item.appendChild(p);
    item.addEventListener('mouseenter', () => _setActive(i));
    // Entire result row is tappable. Navigate explicitly so removing the
    // dialog from the DOM cannot cancel the anchor's default action (race
    // on mobile Safari).
    item.addEventListener('click', () => {
      const route = item.dataset.route;
      closeModal();
      navigate(route);
    });
    container.appendChild(item);
    currentOptions.push(item);
  });

  if (matches.length === 0) {
    const empty = document.createElement('p');
    empty.textContent = strings.search_no_results || 'No results found.';
    container.appendChild(empty);
  }
}
