import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateView, askOutcome } from './chat-gate.js';

test('gateView: storage first', () => {
  assert.equal(gateView({ hasGate: true, hasSecret: false }), 'gate');
  assert.equal(gateView({ hasGate: true, hasSecret: true }), 'input');   // no gate-flash on reload
  assert.equal(gateView({ hasGate: false, hasSecret: false }), 'input'); // open chat
});

test('askOutcome: each status is its own first-class state', () => {
  assert.equal(askOutcome({ online: false, threw: false, status: 0 }), 'offline');
  assert.equal(askOutcome({ online: true, threw: true, status: 0 }), 'unavailable'); // CORS/timeout
  assert.equal(askOutcome({ online: true, threw: false, status: 401 }), 'revoked');
  assert.equal(askOutcome({ online: true, threw: false, status: 429 }), 'over-limit');
  assert.equal(askOutcome({ online: true, threw: false, status: 422 }), 'refused');
  assert.equal(askOutcome({ online: true, threw: false, status: 200 }), 'answer');
  assert.equal(askOutcome({ online: true, threw: false, status: 503 }), 'unavailable');
});

test('askOutcome maps 403 to not_permitted (valid code, ask not in role)', () => {
  assert.equal(askOutcome({ online: true, threw: false, status: 403 }), 'not_permitted');
});

test('askOutcome still maps 401 to revoked (distinct from 403)', () => {
  assert.equal(askOutcome({ online: true, threw: false, status: 401 }), 'revoked');
});
