// Behavioral tests for chat.js stop + auto-scroll. No jsdom: a hand DOM shim (richer
// than test_access-gate.mjs) mounts the REAL chat.js on the non-persistent path and drives
// submit → stream → stop. These guard the two bugs fixed in Aug 2026:
//   1. the stop button was disabled while streaming, so it did nothing;
//   2. stop restored the query AND re-armed send synchronously, so a double-click on stop
//      resubmitted the restored query → duplicate messages.
// Run: node --test components/test_chat-stop.mjs
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

// a real click on an ENABLED type=submit button also submits the form; a disabled button
// fires no click and never submits — emulate both.
const clickButton = (form, send) => {
  if (send.disabled) return;                        // disabled → no click, no submit
  const submits = send.type === 'submit' && form.dataset.mode !== 'stop';
  send.dispatchEvent({ type: 'click' });
  if (submits) form.requestSubmit();
};

// ---- tests ----------------------------------------------------------------
test('stop is clickable while streaming and aborts the turn (was: disabled → no-op)', async () => {
  const { form, input, send } = await mountFresh();
  STREAM = makeStream(); ABORTED = false;
  input.value = 'crear una estrategia';
  form.requestSubmit();
  await tick();
  assert.equal(form.dataset.mode, 'stop', 'turn should enter stop mode');
  assert.equal(send.disabled, false, 'stop button must be enabled or its click never fires');
  assert.equal(input.disabled, true, 'input is frozen during the turn');
  STREAM.emit({ event: 'token', text: 'Hola' });
  await tick();
  send.dispatchEvent({ type: 'click' });          // STOP
  await tick(); await tick();
  assert.equal(ABORTED, true, 'fetch aborted');
  assert.equal(STREAM.cancelled(), true, 'reader cancelled');
  assert.equal(input.value, 'crear una estrategia', 'query restored for editing');
  assert.equal(users(), 0, 'stop UNDOES the send: the user bubble is removed');
  assert.equal(find(MAIN, '.chat-turn-pending'), null, 'the pending/answer turn is removed too');
  assert.equal(find(MAIN, '.chat-turn-error'), null, 'no error surfaced by a user stop');
  assert.equal(form.dataset.mode, 'send', 'composer re-arms to send after teardown');
});

test('repeated send→stop cycles never accumulate bubbles (the pile-up bug)', async () => {
  const { form, input, send } = await mountFresh();
  for (let i = 0; i < 5; i++) {
    STREAM = makeStream();
    input.value = 'quién eres tú?';
    form.requestSubmit();                          // send
    await tick();
    assert.equal(users(), 1, `cycle ${i}: one bubble while streaming`);
    STREAM.emit({ event: 'step', text: 'Procesando' });
    await tick();
    send.dispatchEvent({ type: 'click' });         // stop → undo
    await tick(); await tick();
    assert.equal(users(), 0, `cycle ${i}: stop cleared the bubble`);
    assert.equal(input.value, 'quién eres tú?', `cycle ${i}: text restored`);
  }
});

test('double-clicking stop does NOT resubmit the restored query (the duplicate-message bug)', async () => {
  const { form, input, send } = await mountFresh();
  STREAM = makeStream();
  input.value = 'pregunta doble';
  clickButton(form, send);                          // send
  await tick();
  STREAM.emit({ event: 'token', text: 'x' });
  await tick();
  assert.equal(users(), 1);
  // double-click the stop button (two synchronous clicks)
  clickButton(form, send);
  assert.equal(form.dataset.mode, 'stop', 'still in stop mode between the two clicks');
  clickButton(form, send);
  await tick();
  assert.equal(users(), 0, 'second click is another stop (undo), never a resubmit — no bubble reappears');
});

test('after a stop, tapping send resends the restored text as-is (no edit required)', async () => {
  const { form, input, send } = await mountFresh();
  STREAM = makeStream();
  FETCH_COUNT = 0;
  input.value = 'quién eres tú?';
  clickButton(form, send);                          // send → request 1
  await tick();
  STREAM.emit({ event: 'step', text: 'Procesando' });
  await tick();
  send.dispatchEvent({ type: 'click' });            // STOP → undo, restore text
  await tick(); await tick();
  assert.equal(input.value, 'quién eres tú?', 'text restored');
  assert.equal(send.disabled, false, 'send is enabled so the reader can resend as-is');
  // resend without editing
  clickButton(form, send);                          // request 2
  await tick();
  assert.equal(FETCH_COUNT, 2, 'tapping send resends the restored query');
  assert.equal(users(), 1, 'exactly one live user bubble (no pile-up)');
});

test('hammering the button never piles up bubbles or overlaps streams', async () => {
  const { form, input, send } = await mountFresh();
  STREAM = makeStream();
  input.value = 'quién eres tú?';
  clickButton(form, send);
  await tick();
  STREAM.emit({ event: 'step', text: 'Procesando' });
  await tick();
  // hammer the button; each cycle may fire a request, but the log must never accumulate
  for (let i = 0; i < 8; i++) {
    clickButton(form, send);
    await tick();
    STREAM = makeStream();                          // a fresh stream for any resubmit
    assert.ok(users() <= 1, `hammer ${i}: at most one bubble (undo keeps the log clean)`);
    assert.ok(form.dataset.mode === 'stop' || form.dataset.mode === 'send', 'mode stays valid');
  }
});

test('a submit is ignored while a turn is already streaming (one turn at a time)', async () => {
  const { form, input } = await mountFresh();
  STREAM = makeStream();
  input.value = 'first';
  form.requestSubmit();
  await tick();
  assert.equal(users(), 1);
  // try to sneak a second submit in mid-stream
  input.value = 'second';
  form.requestSubmit();
  await tick();
  assert.equal(users(), 1, 'overlapping submit rejected while streaming');
});

test('streaming auto-scroll follows only while pinned to the bottom', async () => {
  const { form, input, log } = await mountFresh();
  STREAM = makeStream();
  input.value = 'scroll test';
  form.requestSubmit();
  await tick();
  // pinned: near the bottom → token should scroll
  log.scrollHeight = 1000; log.clientHeight = 500; log.scrollTop = 500;   // distance 0
  log.dispatchEvent({ type: 'scroll' });
  SCROLL_CALLS = [];
  STREAM.emit({ event: 'token', text: 'a' });
  await tick();
  assert.ok(SCROLL_CALLS.length >= 1, 'pinned → token auto-scrolls');
  // reader scrolls up → release the pin → tokens must NOT yank the viewport
  log.scrollTop = 0;                                                       // distance 500 > 48
  log.dispatchEvent({ type: 'scroll' });
  SCROLL_CALLS = [];
  STREAM.emit({ event: 'token', text: 'b' });
  await tick();
  assert.equal(SCROLL_CALLS.length, 0, 'scrolled up → token does NOT auto-scroll');
  // back to the bottom → re-arm
  log.scrollTop = 500;
  log.dispatchEvent({ type: 'scroll' });
  SCROLL_CALLS = [];
  STREAM.emit({ event: 'token', text: 'c' });
  await tick();
  assert.ok(SCROLL_CALLS.length >= 1, 'returned to bottom → auto-scroll re-arms');
});
