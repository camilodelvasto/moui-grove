// Diagnostic: OBSERVE what stop actually does to the data model + DOM. Not a test — it
// prints state snapshots so we can confirm (not guess) the behavior. Run:
//   node components/_diag_chat.mjs
// It mounts the REAL chat.js (non-persistent path) and reports, at each transition:
//   - DOM: the turn bubbles rendered in .chat-log
//   - conversation model: the `history` array the client sends on the NEXT request
//     (that array IS active.history, so it reveals whether a stopped turn was recorded)
//   - composer: input.value / input.disabled / send.disabled / mode / flags

// ---- minimal DOM shim (same as test_chat-stop.mjs) ------------------------
function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(), _class: '', dataset: {}, style: {}, _attrs: {}, _listeners: {}, children: [], parentNode: null,
    rows: 0, type: '', disabled: false, value: '', scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    get className() { return this._class; }, set className(v) { this._class = v; },
    classList: { _el: null,
      add(...c) { const s = new Set(this._el._class.split(' ').filter(Boolean)); c.forEach(x => s.add(x)); this._el._class = [...s].join(' '); },
      remove(...c) { const s = new Set(this._el._class.split(' ').filter(Boolean)); c.forEach(x => s.delete(x)); this._el._class = [...s].join(' '); },
      contains(c) { return this._el._class.split(' ').includes(c); }, toggle(c) { this.contains(c) ? this.remove(c) : this.add(c); } },
    get textContent() { return this._text ?? ''; }, set textContent(v) { this._text = String(v); this.children = []; },
    set innerHTML(v) { this._html = String(v); }, get innerHTML() { return this._html ?? ''; },
    setAttribute(k, v) { this._attrs[k] = String(v); }, getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }, hasAttribute(k) { return k in this._attrs; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    append(...ns) { ns.forEach(n => { if (n && typeof n === 'object') n.parentNode = this; this.children.push(n); }); },
    insertBefore(n, ref) { n.parentNode = this; const i = this.children.indexOf(ref); i < 0 ? this.children.push(n) : this.children.splice(i, 0, n); return n; },
    replaceChildren(...ns) { this.children = ns; ns.forEach(n => n && (n.parentNode = this)); },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    addEventListener(ev, fn) { (this._listeners[ev] ||= []).push(fn); }, removeEventListener(ev, fn) { this._listeners[ev] = (this._listeners[ev] || []).filter(f => f !== fn); },
    dispatchEvent(ev) { ev.target ||= this; (this._listeners[ev.type] || []).forEach(fn => fn(ev)); return !ev.defaultPrevented; },
    focus() {}, scrollIntoView() {},
    requestSubmit() { this.dispatchEvent({ type: 'submit', preventDefault() { this.defaultPrevented = true; } }); },
    closest(sel) { let n = this; while (n) { if (elMatches(n, sel)) return n; n = n.parentNode; } return null; },
    querySelector(sel) { return find(this, sel); }, querySelectorAll(sel) { const out = []; findAll(this, sel, out); return out; },
  };
  el.classList._el = el; return el;
}
const camel = (a) => a.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
function elMatches(node, sel) {
  if (!node.dataset) return false;
  if (sel.includes('data-chat-root')) { const ok = node.dataset.chatRoot !== undefined; return sel.includes(':not([data-mounted])') ? ok && node.dataset.mounted === undefined : ok; }
  if (sel.startsWith('.')) return typeof node._class === 'string' && node._class.split(' ').includes(sel.slice(1));
  if (sel.startsWith('[')) return node.dataset[camel(sel.slice(1, -1).split('=')[0])] !== undefined;
  return false;
}
function find(node, sel) { for (const c of node.children || []) { if (c && elMatches(c, sel)) return c; const r = c && c.children && find(c, sel); if (r) return r; } return null; }
function findAll(node, sel, out) { for (const c of node.children || []) { if (c && elMatches(c, sel)) out.push(c); if (c && c.children) findAll(c, sel, out); } }

const MAIN = makeEl('div'); MAIN._attrs.id = 'main';
const CONFIG_EL = makeEl('script'), STRINGS_EL = makeEl('script');
const byId = { main: MAIN, 'chat-config': CONFIG_EL, 'strings-data': STRINGS_EL };
globalThis.document = { getElementById: (id) => byId[id] || null, createElement: (t) => makeEl(t), querySelector: (s) => find(MAIN, s), querySelectorAll: (s) => { const o = []; findAll(MAIN, s, o); return o; }, body: makeEl('body') };
globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {}, location: { pathname: '/inteligencia/estratega', search: '', hash: '' }, history: { pushState() {}, replaceState() {} }, navigator: { onLine: true } };
globalThis.location = window.location; globalThis.history = window.history;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch {}
globalThis.matchMedia = window.matchMedia;
globalThis.sessionStorage = { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } };
globalThis.MutationObserver = class { observe() {} disconnect() {} };

// ---- controllable stream + INSTRUMENTED fetch (captures request bodies) ----
const enc = new TextEncoder();
function makeStream() {
  const q = []; let w = null; let cancelled = false;
  return { cancelled: () => cancelled,
    emit(o) { const v = enc.encode(JSON.stringify(o) + '\n'); w ? (w({ value: v, done: false }), w = null) : q.push({ value: v, done: false }); },
    reader: { read() { return q.length ? Promise.resolve(q.shift()) : new Promise(r => { w = r; }); }, cancel() { cancelled = true; if (w) { w({ value: undefined, done: true }); w = null; } return Promise.resolve(); } } };
}
let STREAM = null, ABORTED = false;
const FETCH_BODIES = [];
globalThis.AbortController = class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; ABORTED = true; } };
globalThis.fetch = async (url, opts) => { FETCH_BODIES.push(JSON.parse(opts.body)); return { ok: true, status: 200, body: { getReader: () => STREAM.reader } }; };

CONFIG_EL._text = JSON.stringify({ endpoint: 'https://relay.test', chats: { '/inteligencia/estratega/': { ask: 'estratega', persist: 'none' } } });
STRINGS_EL._text = JSON.stringify(Object.fromEntries(['chat_input_placeholder', 'chat_send', 'chat_stop', 'chat_working', 'chat_sources', 'chat_error_failed', 'chat_unavailable', 'chat_offline'].map(k => [k, k])));

const tick = () => new Promise(r => setTimeout(r, 0));
const { init } = await import('./chat.js');

MAIN.children = [];
const root = makeEl('div'); root.dataset.chatRoot = ''; root.dataset.ask = 'estratega'; root.dataset.route = '/inteligencia/estratega/';
MAIN.appendChild(root);
init(); await tick(); await tick();

const form = find(MAIN, '.chat-composer'), input = find(MAIN, '.chat-input'), send = find(MAIN, '.chat-send'), logEl = find(MAIN, '.chat-log');

function domTurns() {
  return (logEl.children || []).filter(c => typeof c._class === 'string' && c._class.includes('chat-turn'))
    .map(c => { const role = c._class.includes('chat-turn-user') ? 'user' : c._class.includes('chat-turn-assistant') ? 'assistant' : 'other';
      const pending = c._class.includes('chat-turn-pending'); const p = find(c, '.chat-answer') || (c.children || [])[0];
      const text = (find(c, '.chat-answer')?._html) || (c.children || []).map(k => k._text).filter(Boolean)[0] || c._text || ''; return `${role}${pending ? '(pending)' : ''}:"${text}"`; });
}
function snap(label) {
  console.log(`\n── ${label} ──`);
  console.log('  DOM bubbles in .chat-log :', JSON.stringify(domTurns()));
  console.log('  composer                 : input.value=' + JSON.stringify(input.value) + ' input.disabled=' + input.disabled + ' send.disabled=' + send.disabled + ' mode=' + form.dataset.mode);
  console.log('  flags                    : _stopped=' + form._stopped + ' _armOnEdit=' + form._armOnEdit);
}

console.log('=== OBSERVED DATA MODEL: what stop does ===');
snap('1. initial (fresh, before typing)');

STREAM = makeStream();
input.value = 'quién eres tú?';
console.log('\n>>> user types "quién eres tú?" and hits SEND');
form.requestSubmit();
await tick();
snap('2. after SEND (request in flight)');

STREAM.emit({ event: 'step', text: 'Buscando…' });
await tick();
snap('3. after a step event (still streaming, no answer yet)');

console.log('\n>>> user hits STOP');
ABORTED = false;
send.dispatchEvent({ type: 'click' });
await tick(); await tick();
snap('4. after STOP');
console.log('  DID IT STOP THE STREAM? reader.cancel() called =', STREAM.cancelled(), '| fetch abort() called =', ABORTED);
console.log('\n>>> relay sends a LATE token AFTER stop (it hadn'+"'"+'t honored the abort yet)');
STREAM.emit({ event: 'token', text: 'LATE-TOKEN' });
await tick();
console.log('  is the late token rendered anywhere?', JSON.stringify(domTurns()), '\n    ^ empty/unchanged means the stopped stream is disregarded (its tokens go nowhere)');

console.log('\n>>> user edits the restored text (types a char) then SENDs again');
input.value = 'quién eres tú??';
input.dispatchEvent({ type: 'input' });
STREAM = makeStream();
form.requestSubmit();
await tick();
snap('5. after 2nd SEND');
console.log('\n  history array sent to the relay on request #1 :', JSON.stringify(FETCH_BODIES[0].history));
console.log('  history array sent to the relay on request #2 :', JSON.stringify(FETCH_BODIES[1].history),
  '\n    ^ if the STOPPED turn is absent here, stop truly removed it from the conversation model (not just the DOM)');
