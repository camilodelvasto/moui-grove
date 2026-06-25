import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM shim — no jsdom, no external deps. Mirrors the approach used in
// the sibling test files: node:test + node:assert only. access-gate.js creates
// real DOM elements at call-time, so we need document.createElement available
// globally before importing the module.
function makeElement(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    textContent: '',
    type: '',
    autocomplete: '',
    disabled: false,
    value: '',
    style: {},
    _attrs: {},
    _listeners: {},
    children: [],
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] ?? null; },
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { nodes.forEach((n) => this.children.push(n)); },
    addEventListener(ev, fn) { this._listeners[ev] = fn; },
    focus() { /* no-op in test env */ },
    // querySelector: depth-first search on className (single .class selector only)
    querySelector(sel) {
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      if (!cls) return null;
      return _find(this, cls);
    },
  };
  return el;
}

// _find: depth-first search. Pass cls string for className match, or a predicate fn.
function _find(node, cls, pred) {
  for (const child of node.children) {
    const match = cls
      ? (typeof child.className === 'string' && child.className.split(' ').includes(cls))
      : (pred && pred(child));
    if (match) return child;
    if (child.children) { const r = _find(child, cls, pred); if (r) return r; }
  }
  return null;
}

globalThis.document = { createElement: (tag) => makeElement(tag) };

// button.js calls document.createElement inside the function body only — safe to import.
// strings.js calls document.getElementById at module level — access-gate.js must NOT
// import strings (it receives all text as parameters), so this import is safe.
const { renderAccessGate } = await import('./access-gate.js');

test('renderAccessGate builds the encrypted-grove gate shape', () => {
  const root = makeElement('div');
  let submitted = null;
  renderAccessGate({
    root,
    subtitle: 'Enter code',
    label: 'Access code',
    submit: 'Unlock',
    onSubmit: (v) => { submitted = v; },
  });
  assert.ok(root.querySelector('.gate-subtitle'), 'gate-subtitle present');
  assert.ok(root.querySelector('.gate-form'), 'gate-form present');
  assert.ok(root.querySelector('.gate-error'), 'gate-error present');
});

test('renderAccessGate appends .gate panel to root and returns it', () => {
  const root = makeElement('div');
  const panel = renderAccessGate({
    root,
    subtitle: 'Sub',
    label: 'Label',
    submit: 'Go',
    onSubmit: () => {},
  });
  assert.ok(panel, 'returns a panel element');
  assert.equal(panel.className, 'gate');
  assert.equal(root.children.at(-1), panel, 'panel appended to root');
});

test('renderAccessGate wires submit: onSubmit receives input value + showError helper', () => {
  const root = makeElement('div');
  let receivedValue = null;
  let receivedHelpers = null;
  const panel = renderAccessGate({
    root,
    subtitle: 'Sub',
    label: 'Label',
    submit: 'Go',
    onSubmit: (v, helpers) => { receivedValue = v; receivedHelpers = helpers; },
  });

  // Locate the form's submit listener and fire it
  const form = root.querySelector('.gate-form');
  assert.ok(form, 'form found');
  const preventedEvents = [];
  const fakeEvent = { preventDefault: () => preventedEvents.push(true) };

  // Simulate typing a value into the input. The input is nested inside a label
  // that is a direct child of the form — use _find to search recursively.
  const inputEl = _find(form, null, (c) => c.type === 'password');
  assert.ok(inputEl, 'password input found');
  inputEl.value = 'secret123';

  form._listeners['submit'](fakeEvent);

  assert.equal(preventedEvents.length, 1, 'default prevented');
  assert.equal(receivedValue, 'secret123', 'value passed to onSubmit');
  assert.ok(typeof receivedHelpers.showError === 'function', 'showError helper provided');
});

test('showError sets error text and makes it visible', () => {
  const root = makeElement('div');
  let capturedHelpers = null;
  renderAccessGate({
    root,
    subtitle: 'Sub',
    label: 'Label',
    submit: 'Go',
    onSubmit: (_v, helpers) => { capturedHelpers = helpers; },
  });

  const form = root.querySelector('.gate-form');
  const inputEl = _find(form, null, (c) => c.type === 'password');
  inputEl.value = 'x';
  form._listeners['submit']({ preventDefault: () => {} });

  const error = root.querySelector('.gate-error');
  assert.equal(error.style.display, 'none', 'error hidden initially');
  capturedHelpers.showError('Wrong code');
  assert.equal(error.textContent, 'Wrong code');
  assert.equal(error.style.display, '', 'error visible after showError');
});
