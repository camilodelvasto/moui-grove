// Behavioral tests for chat.js's composer model + auto-scroll. No jsdom: a hand DOM shim
// (richer than test_access-gate.mjs) mounts the REAL chat.js on the non-persistent path and
// drives send → stream → stop. The composer is DECLARATIVE: a single source of truth
// `inflight` (the turn being generated, or null) and the view is a pure function of it —
// active query → STOP + frozen input; idle → SEND + editable. These tests assert the view
// can never drift from that state and never piles up, under stop / resend / mashing / late
// events. Run: node --test components/test_chat-stop.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- minimal DOM ----------------------------------------------------------
let SCROLL_CALLS = [];
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _class: '', dataset: {}, style: {}, _attrs: {}, _listeners: {}, children: [], parentNode: null,
    rows: 0, type: '', disabled: false, value: '',
    scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    get className() { return this._class; }, set className(v) { this._class = v; },
    classList: {
      _el: null,
      add(...c) { const s = new Set(this._el._class.split(' ').filter(Boolean)); c.forEach(x => s.add(x)); this._el._class = [...s].join(' '); },
      remove(...c) { const s = new Set(this._el._class.split(' ').filter(Boolean)); c.forEach(x => s.delete(x)); this._el._class = [...s].join(' '); },
      contains(c) { return this._el._class.split(' ').includes(c); },
      toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); },
    },
    get textContent() { return this._text ?? ''; }, set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html ?? ''; },
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    hasAttribute(k) { return k in this._attrs; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    append(...ns) { ns.forEach(n => { if (n && typeof n === 'object') n.parentNode = this; this.children.push(n); }); },
    insertBefore(n, ref) { n.parentNode = this; const i = this.children.indexOf(ref); i < 0 ? this.children.push(n) : this.children.splice(i, 0, n); return n; },
    replaceChildren(...ns) { this.children = ns; ns.forEach(n => n && (n.parentNode = this)); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); },
    removeEventListener(ev, fn) { this._listeners[ev] = (this._listeners[ev] || []).filter(f => f !== fn); },
    dispatchEvent(ev) { ev.target ||= this; (this._listeners[ev.type] || []).forEach(fn => fn(ev)); return !ev.defaultPrevented; },
    focus() {}, scrollIntoView() { SCROLL_CALLS.push({ el: this }); },
    requestSubmit() { this.dispatchEvent({ type: 'submit', preventDefault() { this.defaultPrevented = true; } }); },
    closest(sel) { let n = this; while (n) { if (elMatches(n, sel)) return n; n = n.parentNode; } return null; },
    querySelector(sel) { return find(this, sel); },
    querySelectorAll(sel) { const out = []; findAll(this, sel, out); return out; },
  };
  el.classList._el = el;
  return el;
}
const camel = (a) => a.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function elMatches(node, sel) {
  if (!node.dataset) return false;
  if (sel.includes('data-chat-root')) {
    const rootOk = node.dataset.chatRoot !== undefined;
    return sel.includes(':not([data-mounted])') ? rootOk && node.dataset.mounted === undefined : rootOk;
  }
  if (sel.startsWith('.')) return typeof node._class === 'string' && node._class.split(' ').includes(sel.slice(1));
  if (sel.startsWith('[')) return node.dataset[camel(sel.slice(1, -1).split('=')[0])] !== undefined;
  return false;
}
function find(node, sel) { for (const c of node.children || []) { if (c && elMatches(c, sel)) return c; const r = c && c.children && find(c, sel); if (r) return r; } return null; }
function findAll(node, sel, out) { for (const c of node.children || []) { if (c && elMatches(c, sel)) out.push(c); if (c && c.children) findAll(c, sel, out); } }

const MAIN = makeEl('div'); MAIN._attrs.id = 'main';
const CONFIG_EL = makeEl('script'), STRINGS_EL = makeEl('script');
const byId = { main: MAIN, 'chat-config': CONFIG_EL, 'strings-data': STRINGS_EL };
globalThis.document = {
  getElementById: (id) => byId[id] || null, createElement: (t) => makeEl(t),
  querySelector: (sel) => find(MAIN, sel), querySelectorAll: (sel) => { const out = []; findAll(MAIN, sel, out); return out; },
  body: makeEl('body'),
};
globalThis.window = {
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  location: { pathname: '/inteligencia/estratega', search: '', hash: '' },
  history: { pushState() {}, replaceState() {} }, navigator: { onLine: true },
};
globalThis.location = window.location; globalThis.history = window.history;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch {}
globalThis.matchMedia = window.matchMedia;
globalThis.sessionStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

// ---- controllable NDJSON stream + fetch/abort mocks -----------------------
const enc = new TextEncoder();
function makeStream() {
  const queue = []; let waiting = null; let cancelled = false;
  return {
    cancelled: () => cancelled,
    emit(obj) { const v = enc.encode(JSON.stringify(obj) + '\n'); waiting ? (waiting({ value: v, done: false }), waiting = null) : queue.push({ value: v, done: false }); },
    end() { waiting ? (waiting({ value: undefined, done: true }), waiting = null) : queue.push({ value: undefined, done: true }); },
    reader: {
      read() { return queue.length ? Promise.resolve(queue.shift()) : new Promise(r => { waiting = r; }); },
      cancel() { cancelled = true; if (waiting) { waiting({ value: undefined, done: true }); waiting = null; } return Promise.resolve(); },
    },
  };
}
let STREAM = null, ABORTED = false, FETCH_COUNT = 0;
globalThis.AbortController = class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; ABORTED = true; } };
globalThis.fetch = async () => { FETCH_COUNT++; return { ok: true, status: 200, body: { getReader: () => STREAM.reader } }; };

CONFIG_EL._text = JSON.stringify({ endpoint: 'https://relay.test', chats: { '/inteligencia/estratega/': { ask: 'estratega', persist: 'none' } } });
STRINGS_EL._text = JSON.stringify(Object.fromEntries(
  ['chat_input_placeholder', 'chat_send', 'chat_stop', 'chat_working', 'chat_sources', 'chat_error_failed', 'chat_unavailable', 'chat_offline'].map(k => [k, k])));

const tick = () => new Promise(r => setTimeout(r, 0));
const { init } = await import('./chat.js');

async function mountFresh() {
  MAIN.children = [];
  const root = makeEl('div');
  root.dataset.chatRoot = ''; root.dataset.ask = 'estratega'; root.dataset.route = '/inteligencia/estratega/';
  MAIN.appendChild(root);
  init();
  await tick(); await tick();
  return { form: find(MAIN, '.chat-composer'), input: find(MAIN, '.chat-input'), send: find(MAIN, '.chat-send'), log: find(MAIN, '.chat-log') };
}
const users = () => document.querySelectorAll('.chat-turn-user').length;

// The button is a pure function of state: aria-label is 'chat_stop' while a query is active,
// 'chat_send' when idle. Clicking it routes — active → stop, idle → send.
const buttonState = (send) => send.getAttribute('aria-label');
const clickSend = (send) => send.dispatchEvent({ type: 'click' });
// The core invariant of the declarative model: the view NEVER drifts from `inflight`.
// input.disabled must equal "is a query active", and the log must never pile up.
const assertConsistent = (send, input, label) => {
  const active = buttonState(send) === 'chat_stop';
  assert.equal(input.disabled, active, `${label}: input.disabled must equal "query active" (${active})`);
  assert.ok(users() <= 1, `${label}: at most one live user bubble (no pile-up), saw ${users()}`);
};

// ---- tests ----------------------------------------------------------------
test('view is derived from one source of truth: active↔STOP+frozen, idle↔SEND+editable', async () => {
  const { input, send } = await mountFresh();
  assert.equal(buttonState(send), 'chat_send', 'fresh → SEND');
  assertConsistent(send, input, 'fresh');
  STREAM = makeStream();
  input.value = 'hola';
  clickSend(send);
  await tick();
  assert.equal(buttonState(send), 'chat_stop', 'active → STOP');
  assertConsistent(send, input, 'streaming');
});

test('stop aborts, undoes the turn, restores the text, view returns to idle synchronously', async () => {
  const { input, send } = await mountFresh();
  STREAM = makeStream(); ABORTED = false;
  input.value = 'crear una estrategia';
  clickSend(send);
  await tick();
  STREAM.emit({ event: 'token', text: 'Hola' });
  await tick();
  clickSend(send);                                  // button is active → STOP
  assert.equal(buttonState(send), 'chat_send', 'view flips to idle SYNCHRONOUSLY on stop — no drift');
  assert.equal(users(), 0, 'the in-flight turn is undone (message removed)');
  assert.equal(input.value, 'crear una estrategia', 'query restored for editing');
  await tick(); await tick();
  assert.equal(ABORTED, true, 'fetch aborted');
  assert.equal(STREAM.cancelled(), true, 'reader cancelled');
  assert.equal(find(MAIN, '.chat-turn-pending'), null, 'pending answer removed too');
  assert.equal(find(MAIN, '.chat-turn-error'), null, 'no error surfaced by a user stop');
  assertConsistent(send, input, 'after stop');
});

test('after a stop, clicking send resends the restored text as-is (no edit)', async () => {
  const { input, send } = await mountFresh();
  STREAM = makeStream(); FETCH_COUNT = 0;
  input.value = 'quién eres tú?';
  clickSend(send); await tick();
  STREAM.emit({ event: 'step', text: 'Procesando' }); await tick();
  clickSend(send);                                  // STOP
  await tick(); await tick();
  assert.equal(FETCH_COUNT, 1);
  assert.equal(input.value, 'quién eres tú?', 'text restored');
  STREAM = makeStream();
  clickSend(send);                                  // idle → SEND (resend as-is)
  await tick();
  assert.equal(FETCH_COUNT, 2, 'an idle click resends the restored query');
  assert.equal(users(), 1, 'one live bubble, no pile-up');
  assertConsistent(send, input, 'after resend');
});

test('a send is ignored while a query is active (one turn at a time)', async () => {
  const { form, input, send } = await mountFresh();
  STREAM = makeStream(); FETCH_COUNT = 0;
  input.value = 'first';
  clickSend(send); await tick();
  assert.equal(users(), 1);
  input.value = 'second';
  form.requestSubmit();                             // sneak a second send (e.g. Enter) mid-stream
  await tick();
  assert.equal(FETCH_COUNT, 1, 'no second request while a query is active');
  assert.equal(users(), 1, 'no overlapping turn');
});

test('NO invalid state under mashing — the view never drifts and never piles up', async () => {
  const { input, send } = await mountFresh();
  STREAM = makeStream();
  input.value = 'quién eres tú?';
  clickSend(send); await tick();
  STREAM.emit({ event: 'step', text: 'Procesando' }); await tick();
  // Mash: each click flips active↔idle (stop↔send). Wherever it lands, the view must stay
  // consistent with `inflight` and the log must never accumulate. (The trivial morph model:
  // active→stop, idle→send — with the invariant enforced by design, not by guard flags.)
  for (let i = 0; i < 12; i++) {
    clickSend(send);
    await tick();
    STREAM = makeStream();                          // fresh stream for any resend
    assertConsistent(send, input, `mash ${i}`);
  }
});

test('a stopped turn cannot resurrect the view: late stream events after stop are ignored', async () => {
  const { input, send } = await mountFresh();
  STREAM = makeStream();
  input.value = 'quién eres tú?';
  clickSend(send); await tick();
  clickSend(send);                                  // STOP before any token
  await tick(); await tick();
  assert.equal(users(), 0);
  // the aborted relay dribbles late events; the stale turn must not render them
  STREAM.emit({ event: 'step', text: 'LATE-STEP' });
  STREAM.emit({ event: 'token', text: 'LATE-TOKEN' });
  await tick();
  assert.equal(users(), 0, 'no bubble resurrected');
  assert.equal(find(MAIN, '.chat-answer'), null, 'no answer rendered from a stopped turn');
  assert.equal(buttonState(send), 'chat_send', 'view stays idle');
});

test('streaming auto-scroll follows only while pinned to the bottom', async () => {
  const { input, send, log } = await mountFresh();
  STREAM = makeStream();
  input.value = 'scroll test';
  clickSend(send);
  await tick();
  log.scrollHeight = 1000; log.clientHeight = 500; log.scrollTop = 500;   // at the bottom
  log.dispatchEvent({ type: 'scroll' });
  SCROLL_CALLS = [];
  STREAM.emit({ event: 'token', text: 'a' });
  await tick();
  assert.ok(SCROLL_CALLS.length >= 1, 'pinned → token auto-scrolls');
  log.scrollTop = 0;                                                       // scrolled up
  log.dispatchEvent({ type: 'scroll' });
  SCROLL_CALLS = [];
  STREAM.emit({ event: 'token', text: 'b' });
  await tick();
  assert.equal(SCROLL_CALLS.length, 0, 'scrolled up → token does NOT auto-scroll');
  log.scrollTop = 500;                                                    // back to the bottom
  log.dispatchEvent({ type: 'scroll' });
  SCROLL_CALLS = [];
  STREAM.emit({ event: 'token', text: 'c' });
  await tick();
  assert.ok(SCROLL_CALLS.length >= 1, 'returned to bottom → auto-scroll re-arms');
});
