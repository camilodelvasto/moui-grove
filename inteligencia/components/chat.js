// chat.js — the grove chat feature client. A static, record-driven chat over a
// corpus. Mounts on a [data-chat-root] marker placed in #main for a type: chat
// route, re-mounting after client-side navigations via a MutationObserver
// (grove has no per-route view lifecycle). The endpoint comes from the
// build/dev-injected <script id="chat-config">. Model and passage text is
// rendered as inert content via textContent — never innerHTML.
//
// Persistence (persist: local): a conversation is the active record. It has NO
// stored record until the first answer's title arrives; then it's named, slugged,
// persisted to IndexedDB (chat-idb), and the URL becomes /<base>/<slug>/. The chat
// owns this URL: it derives the slug from the route, writes it with pushState on
// naming, and restores on popstate — all without a page load. For persist: none (or
// absent) the chat behaves exactly as the MVP: an in-memory conversation, no store,
// no URL writing. The declaration gates the whole feature.
import { strings } from '../strings.js';
import { gateView, askOutcome } from './chat-gate.js';
import { renderAnswer, monogram } from './chat-render.js';
import { renderUntrusted } from '../markdown.js';
import { currentRoute, buildHref } from '../navigation.js';
import { makeRecord, dedupeSlug, slugFromRoute, toWireTurns, toStoredTurns } from './chat-store.js';
import { get as idbGet, put as idbPut, list as idbList, remove as idbRemove } from './chat-idb.js';
import { create as createSidebar, confirmDelete } from './chat-sidebar.js';
import { open as openModal } from './modal.js';
import { renderAccessGate } from './access-gate.js';

// Static, trusted icon literals — NOT untrusted model/visitor content. Hardcoded SVG
// constants assigned via innerHTML are safe (no interpolation) and do not touch the
// rendering invariant (which governs model answers + visitor text). Minimal line icons,
// stroke: currentColor so they inherit text color.
const ICON_MENU =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"></rect><line x1="9.5" y1="4" x2="9.5" y2="20"></line></svg>';
const ICON_SEND =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="19" x2="12" y2="5"></line><polyline points="5 12 12 5 19 12"></polyline></svg>';

function _config() {
  const el = document.getElementById('chat-config');
  if (!el) return null;
  try {
    return JSON.parse(el.textContent);   // { endpoint, chats: { "<base>": { ask, persist, ... } } }
  } catch {
    return null;                         // malformed config → _mount renders the failed state
  }
}

export function init() {
  const main = document.getElementById('main');
  if (!main) return;
  const mount = () => {
    const root = main.querySelector('[data-chat-root]:not([data-mounted])');
    // _mount is async (restore reads IndexedDB); it sets data-mounted synchronously
    // before its first await, so the guard above still prevents a double mount. A
    // rejection surfaces loudly — never silently — per the no-silent-failure rule.
    if (root) _mount(root).catch((err) => console.error('chat: mount failed', err));
  };
  mount();                                                   // current page, if a chat route
  // childList only — NOT subtree. The router swaps #main's direct children, so a
  // chat route's marker arrives as a direct-child change. subtree:true would also
  // fire on every message the chat appends into its own log (a descendant write),
  // re-running mount() on each turn for nothing.
  new MutationObserver(mount).observe(main, { childList: true });
}

async function _mount(root) {
  root.dataset.mounted = '1';
  const ask = root.dataset.ask;
  if (!ask) throw new Error('chat root missing data-ask');
  // The chat's base route (e.g. '/assistant/'). Server emits it on the root so the
  // client can derive the slug and own the URL. Required for a routed chat.
  const base = root.dataset.route;
  if (!base) throw new Error('chat root missing data-route');
  const config = _config();
  const endpoint = config && config.endpoint;
  const gate = config && config.gate;              // {scheme, check} | undefined
  const GROVE_KEY = (config && config.grove_key) || base;   // per-grove single entry; fall back to route only if absent
  const SECRET_KEY = 'grove-chat-secret:' + GROVE_KEY;
  const heldSecret = () => sessionStorage.getItem(SECRET_KEY); // the secret string, not a flag
  // Per-chat config keyed by base route. No-fallbacks: persist is a defined value
  // (Task 3 defaults absent → "none" at build), so its absence here means the config
  // is malformed, not "guess none". Treat a missing chats entry as the failed state.
  const chatCfg = config && config.chats && config.chats[base];
  const persist = chatCfg && chatCfg.persist;

  const log = document.createElement('div');
  log.className = 'chat-log';
  const form = document.createElement('form');
  form.className = 'chat-composer';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chat-input';
  // Strings are content, never hardcoded: a grove that declares a chat feature is
  // required at build to provide the chat_* keys (build.py CHAT_STRING_KEYS), so we
  // read them directly with no English fallback.
  input.placeholder = strings.chat_input_placeholder;
  input.setAttribute('aria-label', strings.chat_input_placeholder);
  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'chat-send';
  send.innerHTML = ICON_SEND;                              // static trusted icon, not untrusted content
  send.setAttribute('aria-label', strings.chat_send);     // keyed label kept for a11y
  form.append(input, send);

  // The conversation pane (log + composer). For a persist: local chat it sits next
  // to the sidebar inside a layout wrapper; for a non-local chat it is the whole UI.
  // A slim top bar carries the mobile hamburger (the drawer toggle) above the log; it
  // is created here but only wired/shown for the persistent layout below (CSS hides
  // .chat-menu on desktop, where the rail is persistent).
  const pane = document.createElement('div');
  pane.className = 'chat-pane';
  const bar = document.createElement('div');
  bar.className = 'chat-bar';
  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'chat-menu';
  menu.innerHTML = ICON_MENU;                              // static trusted icon, not untrusted content
  menu.setAttribute('aria-label', strings.chat_sidebar_label);
  bar.append(menu);
  pane.append(bar, log, form);
  root.append(pane);

  if (!endpoint || !chatCfg) {                              // no-fallbacks: say it, don't pretend
    _append(log, 'error', strings.chat_error_failed);
    input.disabled = true; send.disabled = true;
    return;
  }

  // Whether IndexedDB persistence is on for this chat. Anything other than the
  // declared 'local' (i.e. 'none') keeps the MVP's ephemeral behavior verbatim.
  const persistent = persist === 'local';
  // The store namespace is the base route ALONE — the browser already origin-scopes
  // IndexedDB, so the route isolates chatbots within a site. There is no grove id.
  const ns = base;

  // Active conversation. `history` is the in-memory turn list sent to the endpoint
  // (MVP wire contract, unchanged). `record` is the persisted record once named —
  // null until the first answer arrives. Mutated in place across turns and popstate.
  const active = { history: [], record: null };

  // Render a record's turns into a fresh log (used on restore + popstate). Clears the
  // log first so a restore never stacks onto a previous conversation. The intro
  // persists at the top of the log, above the first turn.
  const renderRecord = (rec) => {
    log.textContent = '';
    _renderIntro(log, chatCfg);
    active.history = [];
    active.record = rec;
    for (const turn of rec.turns) {
      if (turn.role === 'user') {
        _appendTurn(log, 'user', turn.content);
        active.history.push({ role: 'user', content: turn.content });
      } else {
        // Stored assistant turns carry the answer string plus their saved `sources`
        // ([{n,title}]); re-render both the way a live answer renders. A turn saved
        // before sources were persisted has no `sources` (undefined) — it restores
        // answer-only (legacy compat). Carry sources back into active.history so a
        // follow-up turn re-persists them unchanged via toStoredTurns.
        _appendStoredAnswer(log, turn.content, turn.sources, chatCfg);
        active.history.push({ role: 'assistant', content: turn.content, sources: turn.sources });
      }
    }
  };

  // Show the fresh entry state: empty log, ready composer. No record, no URL slug.
  // The entry header (bot identity, when present) and the operator intro (when
  // authored) head the entry state, above the composer.
  const renderFresh = () => {
    log.textContent = '';
    const identity = _identityStrip(chatCfg);
    if (identity) {
      identity.classList.add('chat-identity-header');
      log.appendChild(identity);
    }
    _renderIntro(log, chatCfg);
    active.history = [];
    active.record = null;
  };

  // Restore the conversation named by the current route (or the fresh entry state for
  // the bare base). `clean` true → a dangling slug (in URL, not in store) is dropped
  // with replaceState BEFORE any turn renders, so there's no flash of a wrong/half
  // conversation. Returns nothing; mutates `active` and the log.
  const restoreFromUrl = async (clean) => {
    const slug = slugFromRoute(currentRoute(), base);
    if (slug === '') { renderFresh(); return; }              // bare base → fresh
    const rec = await idbGet(ns, slug);
    if (rec) { renderRecord(rec); return; }                 // deep link / reload → restore
    // Dangling slug: deleted conversation or a cross-device link. Drop it silently to
    // the bare base, then render fresh. replaceState (not push) so back doesn't return
    // to the dead slug. buildHref makes the href strategy- and basePath-correct.
    if (clean) history.replaceState(null, '', buildHref(base));
    renderFresh();
  };

  // The sidebar (persist: local only). chat.js owns the store/active/URL; the sidebar
  // is a dumb view that emits select/new/delete intents. `sidebar` is null for a
  // non-local chat — there is no conversation history to list. refreshSidebar reads
  // the namespace's records and redraws the list, marking the active slug (the active
  // record's slug, or null for the fresh entry state). Called after every state change
  // that the list reflects: restore, select, new, name-on-first-answer, delete.
  let sidebar = null;
  const activeSlug = () => (active.record ? active.record.slug : null);
  const refreshSidebar = async () => {
    if (!sidebar) return;
    sidebar.render(await idbList(ns), activeSlug());
  };

  // Select a stored conversation from the sidebar: write the slug to the URL and
  // restore it through the SAME path popstate/mount uses (one restore, three callers).
  // pushState first so restoreFromUrl reads the new route; no clean needed (the slug
  // came from the store, so it cannot be dangling).
  const selectConversation = async (slug) => {
    history.pushState(null, '', buildHref(base + slug + '/'));
    await restoreFromUrl(false);
    await refreshSidebar();
  };

  // New chat: go to the bare base and show the fresh entry state. The conversation is
  // NOT persisted until its first answer names it (nameAndPersist), so clicking this
  // repeatedly leaves no empty records behind. pushState (not replace) so back returns
  // to the prior conversation.
  const newConversation = async () => {
    history.pushState(null, '', buildHref(base));
    renderFresh();
    await refreshSidebar();
  };

  // Delete a conversation behind a modal-shell confirm. The confirm node is composed
  // by the sidebar; we open it through the shared shell (modal.js). CAPTURE the slug
  // and whether it was the active conversation into locals BEFORE closing the modal —
  // the close fires onClose on a LATER task, so reading `active` after close() would
  // race. On confirm: remove from the store, then if it was active drop to the bare
  // base + fresh entry state. Either way refresh the list.
  const deleteConversation = (slug) => {
    const wasActive = activeSlug() === slug;
    let confirmed = false;
    const node = confirmDelete(
      () => { confirmed = true; close(); },
      () => { close(); },
    );
    const close = openModal(node, {
      onClose: async () => {
        if (!confirmed) return;
        await idbRemove(ns, slug);
        if (wasActive) {
          history.pushState(null, '', buildHref(base));
          renderFresh();
        }
        await refreshSidebar();
      },
    });
  };

  // Name a fresh conversation on its first answer: build the record from the backend's
  // title, dedupe its slug against the namespace's taken slugs read FRESH at name time,
  // persist it, set it active, and push the slug into the URL. Transparent to the
  // visitor. No-op for an already-named conversation.
  const nameAndPersist = async (record) => {
    const title = record.title;
    if (typeof title !== 'string') throw new Error('chat: answer record missing title (Task 1 contract)');
    // toStoredTurns preserves `sources` on assistant turns (dropped from user turns and
    // the wire). makeRecord stores turns as-given, so the stored shape rides through.
    const rec = makeRecord(title, toStoredTurns(active.history));
    const taken = new Set((await idbList(ns)).map((r) => r.slug));
    rec.slug = dedupeSlug(rec.slug, taken);
    active.record = rec;
    await idbPut(ns, rec);
    history.pushState(null, '', buildHref(base + rec.slug + '/'));
  };

  // Append the latest turn pair to the active record and re-persist (bump updated).
  // Title and slug never change after naming.
  const appendAndPersist = async () => {
    const rec = active.record;
    // Preserve each assistant turn's `sources` (the stored numbered list); previously
    // this reshaped to { role, content } and dropped them.
    rec.turns = toStoredTurns(active.history);
    rec.updated = Date.now();
    await idbPut(ns, rec);
  };

  // Wire the submit handler and set up persistence/sidebar.
  // Called either directly (no gate) or from renderGate's onAccept (after check 204).
  // All references to `active`, `log`, `form`, `input`, `send`, `pane`, `bar`, `menu`,
  // `sidebar`, `persistent`, `ns`, `gate`, `heldSecret`, `SECRET_KEY`, `chatCfg`,
  // `endpoint`, `ask` are closed over from _mount.
  const mountChatSurface = async () => {
    // Reveal the rail now that we're mounting the surface (not gating). The rail is
    // hidden until .chat-ready so the live/static-rendered rail never flashes before
    // a gate; the gated path (renderGate) never reaches here, so it stays hidden.
    const appShellEl = root.closest('.app-shell');
    if (appShellEl) appShellEl.classList.add('chat-ready');
    if (persistent) {
      // `closeDrawer` is declared before createSidebar so the select/new callbacks can
      // close the drawer after navigating. In app mode (slot present) it stays a no-op
      // because there is no drawer — the rail is always-visible chrome.
      let closeDrawer = () => {};

      sidebar = createSidebar({
        onSelect: (slug) => { closeDrawer(); selectConversation(slug).catch((err) => console.error('chat: select failed', err)); },
        onNew: () => { closeDrawer(); newConversation().catch((err) => console.error('chat: new failed', err)); },
        onDelete: deleteConversation,
      });

      const slot = document.querySelector('[data-chat-sidebar-slot]');
      if (slot) {
        // App-shell: the rail is the chrome. Mount the conversation list into its slot.
        slot.replaceChildren(sidebar.element);
        // Mobile-first: the rail is an off-canvas drawer toggled by the hamburger; a
        // backdrop closes it; selecting/new closes it (closeDrawer). Desktop CSS keeps
        // the rail static and hides the hamburger + backdrop (≥768px).
        const shell = root.closest('.app-shell');
        if (shell) {
          closeDrawer = () => shell.classList.remove('is-rail-open');
          menu.addEventListener('click', () => shell.classList.toggle('is-rail-open'));
          const backdrop = document.createElement('div');
          backdrop.className = 'chat-backdrop';
          backdrop.addEventListener('click', closeDrawer);
          shell.appendChild(backdrop);
        }
      } else {
        // In-page chat (page/article body): off-canvas drawer + backdrop as before.
        // The layout wrapper is the flex row on desktop; on mobile the sidebar is an
        // off-canvas drawer toggled by `is-drawer-open` on this wrapper (CSS owns the
        // transform/backdrop).
        const layout = document.createElement('div');
        layout.className = 'chat-layout';
        closeDrawer = () => layout.classList.remove('is-drawer-open');

        // The hamburger toggles the drawer; the backdrop (under the drawer, fades in)
        // closes it on click. Both are display:none on desktop where the rail is static.
        menu.addEventListener('click', () => layout.classList.toggle('is-drawer-open'));
        const backdrop = document.createElement('div');
        backdrop.className = 'chat-backdrop';
        backdrop.addEventListener('click', closeDrawer);

        // Lay the sidebar beside the conversation pane. The pane already holds bar + log +
        // composer. Backdrop sits between sidebar and pane in source order; CSS layers it.
        root.insertBefore(layout, pane);
        layout.append(sidebar.element, backdrop, pane);
      }
      // Restore BEFORE wiring submit so a deep-linked reload shows its conversation
      // first; clean a dangling slug before anything renders. Runs once per mount in
      // BOTH layouts (hoisted out of the branch so it can't be missed by a new branch).
      await restoreFromUrl(true);
      await refreshSidebar();
      // No per-mount popstate listener: subtree restore on back/forward is handled by the
      // router's remount. The dev catch-all returns this chat fragment for any slug under
      // the base, so a same-base popstate → router _swap rewrites #main.innerHTML → the
      // childList MutationObserver fires → _mount runs again → await restoreFromUrl(true)
      // above re-derives the slug and restores. A chat-owned popstate listener would
      // duplicate and race that restore, and leak (one dead listener per mount). Revisit
      // ONLY if a production transport stops remounting on same-base slug changes (diffs
      // and skips identical fragments); then the router — not a per-mount global listener —
      // should own subtree restore.
    } else {
      // Non-local chat: no store, no sidebar — but the entry state still heads with
      // the operator intro (when authored). renderFresh paints the empty log + intro.
      renderFresh();
    }

    if (!form._submitWired) {
      form._submitWired = true;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const question = input.value.trim();
        if (!question) return;
        input.value = '';
        _appendTurn(log, 'user', question);
        let pending = _appendPending(log, chatCfg);
        input.disabled = true; send.disabled = true;
        try {
          // Re-read the secret each ask — never a cached "we're authed" flag.
          const headers = { 'Content-Type': 'application/json' };
          const secret = heldSecret();
          if (secret) headers['Authorization'] = 'Bearer ' + secret;
          const res = await fetch(endpoint.replace(/\/$/, '') + '/ask/' + encodeURIComponent(ask), {
            method: 'POST', headers,
            // Wire contract: turns are EXACTLY { role, content }. active.history may now
            // carry `sources` on assistant turns (a client display concern); strip it.
            body: JSON.stringify({ question, history: toWireTurns(active.history) }),
          });
          const outcome = askOutcome({ online: navigator.onLine, threw: false, status: res.status });
          if (outcome === 'refused') {
            pending.remove();
            const body = await res.json().catch(() => null);
            const detail = body && body.error && body.error.detail;
            _append(log, 'refused', strings.chat_error_refused + (detail ? ' (' + detail + ')' : ''));
            return;
          }
          if (outcome === 'not_permitted') {            // 403: valid code, ask not in role
            pending.remove();
            _append(log, 'error', strings.chat_not_permitted); // stay on input; no renderGate
            return;
          }
          if (outcome === 'revoked') {                          // 401: secret no longer accepted
            pending.remove();
            sessionStorage.removeItem(SECRET_KEY);             // drop the held secret
            _append(log, 'error', strings.chat_revoked);
            renderGate(root, gate, SECRET_KEY, () => mountChatSurface().catch((err) => console.error('chat: mount failed', err)));
            return;
          }
          if (outcome === 'over-limit') {                       // 429: per-request capacity judgment
            pending.remove();
            _append(log, 'error', strings.chat_over_limit);    // stay on input, preserve it
            return;
          }
          if (outcome === 'unavailable') {
            pending.remove();
            console.warn('[chat] ask unavailable', { status: res.status });  // diagnosable
            _append(log, 'error', strings.chat_unavailable);
            return;
          }
          // outcome === 'answer'
          const record = await res.json();
          // Capture the SAME ordered source list the live render computes (positional,
          // first-appearance order — sources[0] aligns with the renumbered [1]). It is
          // stored on the assistant turn so a restored answer renders its sources list.
          const { sources } = _fillAnswer(pending, record, chatCfg);
          pending = null;   // the pending turn IS the live answer now; the catch must not remove it
          const wasNamed = active.record !== null;
          active.history.push({ role: 'user', content: question });
          if (record.answer) active.history.push({ role: 'assistant', content: record.answer, sources });
          if (persistent) {
            // A refusal/answer with no answer text still names on first success (the turn
            // happened); subsequent turns append. The store layer is loud on its own
            // failures, so we don't swallow — but a persistence failure must not break the
            // live conversation, which is already rendered.
            if (!wasNamed) await nameAndPersist(record);
            else await appendAndPersist();
            // Reflect the named-on-first-answer record (new list entry, now active) and
            // the bumped recency ordering after an append.
            await refreshSidebar();
          }
        } catch (err) {
          if (pending) pending.remove();   // only a still-pending dot; never the filled answer
          const outcome = askOutcome({ online: navigator.onLine, threw: true, status: 0 });
          if (outcome === 'offline') {
            _append(log, 'error', strings.chat_offline);
          } else {
            // CORS rejection / timeout — collapses to "unavailable" for the user, but the
            // operator must be able to tell it apart from a clean offline.
            console.warn('[chat] ask failed (network/CORS/timeout)', err);
            _append(log, 'error', strings.chat_unavailable);
          }
        } finally {
          input.disabled = false; send.disabled = false;
          input.focus();
        }
      });
    }
  };

  // Storage-first boot: read sessionStorage BEFORE rendering anything.
  // gateView decides gate vs input from secret presence only — no flash on reload.
  const view = gateView({ hasGate: !!gate, hasSecret: !!heldSecret() });
  if (view === 'gate') {
    renderGate(root, gate, SECRET_KEY, () => mountChatSurface().catch((err) => console.error('chat: mount failed', err)));
    return;
  }
  await mountChatSurface();
}

// Render the secret-gate full-screen chromeless. The chat root gets a chat-gated class
// so CSS hides the rail/app-shell while the gate is shown; on 204 from gate.check it
// stores the secret in sessionStorage, removes the class, removes the gate panel, and
// calls onAccept (which mounts the chat surface). Non-204 shows the gate error.
// onAccept is called synchronously in a fire-and-forget pattern — the gate panel is
// removed before the async mountChatSurface proceeds, so root layout stays clean.
function renderGate(root, gate, secretKey, onAccept) {
  root.classList.add('chat-gated');   // CSS hides the rail/app-shell while gated

  const gatePanel = renderAccessGate({
    root,
    subtitle: strings.chat_gate_prompt,
    label: strings.gate_label,
    submit: strings.chat_gate_submit,
    onSubmit: async (secret, { showError }) => {
      try {
        const res = await fetch(gate.check, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + secret },
        });
        if (res.status === 204) {
          sessionStorage.setItem(secretKey, secret); // hold the secret string
          // Remove the gate panel and the gated class before mounting the surface.
          gatePanel.remove();
          root.classList.remove('chat-gated');
          onAccept(); // fire-and-forget: mountChatSurface handles its own errors
          return;
        }
        const outcome = askOutcome({ online: navigator.onLine, threw: false, status: res.status });
        if (outcome === 'revoked') {
          showError(strings.chat_gate_rejected);
        } else {
          console.warn('[chat] gate check failed', { status: res.status });
          showError(strings.chat_unavailable);
        }
      } catch (err) {
        const outcome = askOutcome({ online: navigator.onLine, threw: true, status: 0 });
        if (outcome === 'offline') {
          showError(strings.chat_offline);
        } else {
          console.warn('[chat] gate check failed (network/CORS/timeout)', err);
          showError(strings.chat_unavailable);
        }
      }
    },
  });
}

// Render the operator intro at the top of the log. THIS IS THE ONE SANCTIONED
// LIVE-HTML RENDER in the chat: chatCfg.intro_html is operator-authored markdown,
// server-rendered to HTML at build/serve time (server.py _chat_presentation) — it is
// NEVER model output and NEVER visitor text, so innerHTML is correct here, not a
// broken inert rule. A later reader: do not "fix" this to textContent. Absent intro →
// render nothing (no empty box). Called first, so it heads the log above every turn.
function _renderIntro(log, chatCfg) {
  if (!chatCfg || !chatCfg.intro_html) return;
  const el = document.createElement('div');
  el.className = 'chat-intro';
  el.innerHTML = chatCfg.intro_html;                         // sanctioned: server-rendered operator markdown
  log.appendChild(el);
}

// Build the assistant identity strip (avatar + name) from config — PRESENTATION, pulled
// from chatCfg, NEVER from the stored record. Absent avatar → name only; absent name AND
// avatar → null (caller renders no strip). The avatar's alt is the bot's name (or '' when
// nameless). Returns the element or null.
function _identityStrip(chatCfg) {
  if (!chatCfg) return null;
  const name = chatCfg.name;
  const avatar = chatCfg.avatar;
  if (!name && !avatar) return null;
  const strip = document.createElement('div');
  strip.className = 'chat-identity';
  const mono = () => {
    const el = document.createElement('span');
    el.className = 'chat-avatar chat-avatar-mono';
    el.textContent = monogram(name);
    el.setAttribute('aria-hidden', 'true');
    return el;
  };
  if (avatar) {
    const img = document.createElement('img');
    img.className = 'chat-avatar';
    img.src = avatar;
    img.alt = name || '';
    // Broken URL must not leave an empty chip: swap to the monogram on error.
    img.addEventListener('error', () => { if (name) img.replaceWith(mono()); else img.remove(); });
    strip.appendChild(img);
  } else if (name) {
    strip.appendChild(mono());
  }
  if (name) {
    const label = document.createElement('span');
    label.className = 'chat-identity-name';
    label.textContent = name;                                // inert
    strip.appendChild(label);
  }
  return strip;
}

function _appendTurn(log, role, text) {
  const el = document.createElement('div');
  el.className = 'chat-turn chat-turn-' + role;
  const p = document.createElement('p');
  p.textContent = text;                                      // inert
  el.appendChild(p);
  log.appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

function _append(log, kind, text) {
  const el = document.createElement('div');
  el.className = 'chat-turn chat-turn-' + kind;
  el.textContent = text;                                     // inert
  log.appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

// Render an answer body into an assistant-turn element: markdown via grove's own
// markdown.js, but the UNTRUSTED instance (html:false): markdown-it escapes raw HTML
// and blocks dangerous link schemes, so the model can't inject markup while **bold**,
// lists, and headings render and inherit grove's global prose styles. If the vendored
// lib isn't on the page, fall back to inert text (raw, never unsafe). One body path for
// live and restored answers — both pass already-renumbered [1],[2] text.
function _renderAnswerBody(el, answerText) {
  const body = document.createElement('div');
  body.className = 'chat-answer';
  const html = renderUntrusted(answerText);
  if (html !== null) body.innerHTML = html;
  else body.textContent = answerText;
  el.appendChild(body);
}

// Append the numbered sources list ([{n,title}], positional to the [1..n] markers) to an
// assistant-turn element. The single sources-markup path for BOTH the live answer and a
// restored answer — restore reuses this, never duplicates the markup. No-op for an empty
// list (no citations, or a legacy turn stored before sources were persisted).
function _appendSources(el, sources) {
  if (!sources || !sources.length) return;
  const label = document.createElement('p');
  label.className = 'chat-sources-label';
  label.textContent = strings.chat_sources;
  el.appendChild(label);
  const ol = document.createElement('ol');
  ol.className = 'chat-sources';
  for (const s of sources) {
    const li = document.createElement('li');
    li.textContent = s.title;                                // the record's `name`, inert
    ol.appendChild(li);
  }
  el.appendChild(ol);
}

// Render a stored assistant turn: the saved answer string, verbatim — identical to the
// live path (renderAnswer), which no longer transforms the answer. `sources` is the
// per-turn saved list; new turns store [] (the engine appends no source list), so
// _appendSources renders nothing. A legacy turn saved with a non-empty `sources` still
// restores it — that is restoring what was persisted, not a fallback that masks an error.
function _appendStoredAnswer(log, answer, sources, chatCfg) {
  const el = document.createElement('div');
  el.className = 'chat-turn chat-turn-assistant';
  const identity = _identityStrip(chatCfg);
  if (identity) el.appendChild(identity);                     // bot face/name beside the turn
  _renderAnswerBody(el, answer || '');                        // verbatim, same as live
  _appendSources(el, sources);
  log.appendChild(el);
  el.scrollIntoView({ block: 'end' });
}

// Pending assistant turn: the SAME identity strip an answer has, with a single
// breathing dot as its body. Rendering the identity now means the answer fills in
// place (see _fillAnswer) with no layout shift. The working string stays as an
// accessible status label for screen readers.
function _appendPending(log, chatCfg) {
  const el = document.createElement('div');
  el.className = 'chat-turn chat-turn-assistant chat-turn-pending';
  const identity = _identityStrip(chatCfg);
  if (identity) el.appendChild(identity);
  const body = document.createElement('div');
  body.className = 'chat-answer';
  const dot = document.createElement('span');
  dot.className = 'chat-thinking-dot';
  dot.setAttribute('role', 'status');
  dot.setAttribute('aria-label', strings.chat_working);
  body.appendChild(dot);
  el.appendChild(body);
  log.appendChild(el);
  el.scrollIntoView({ block: 'end' });
  return el;
}

// Fill a pending turn with its answer IN PLACE: drop the dot body, render the
// answer into the same element (fading it in), append sources. Reuses the identity
// strip already present, so the strip never re-lays-out. Returns { sources } like
// _appendAnswer so the caller stores the SAME positional list.
function _fillAnswer(el, record, chatCfg) {
  el.classList.remove('chat-turn-pending');
  const oldBody = el.querySelector('.chat-answer');
  if (oldBody) oldBody.remove();
  const { answerText, sources } = renderAnswer(record);
  _renderAnswerBody(el, answerText);
  const body = el.querySelector('.chat-answer');
  if (body) body.classList.add('chat-answer--enter');
  _appendSources(el, sources);
  el.scrollIntoView({ block: 'end' });
  return { sources };
}
