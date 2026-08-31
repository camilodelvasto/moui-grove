import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeRecord, slugFor, dedupeSlug, sortByRecency, slugFromRoute, toWireTurns, toStoredTurns } from './chat-store.js';

describe('chat-store', () => {
  it('builds a record from a title and turns', () => {
    const r = makeRecord('Contratos de alquiler', [{ role: 'user', content: 'q' }]);
    assert.equal(r.title, 'Contratos de alquiler');
    assert.equal(r.slug, 'contratos-de-alquiler');
    assert.equal(r.turns.length, 1);
    assert.ok(r.id && r.created);
  });

  it('slugifies: lowercase, hyphens, strips punctuation and accents', () => {
    assert.equal(slugFor('¿Qué dice la ley?'), 'que-dice-la-ley');
  });

  it('returns the sentinel "chat" when a title slugifies to empty', () => {
    // Punctuation-only, emoji-only, non-Latin, and empty titles all strip to ''.
    // They must not collapse onto the empty-string IDB key — each gets a stable,
    // non-empty key that the caller then dedupes.
    assert.equal(slugFor('!!!'), 'chat');
    assert.equal(slugFor('🔥'), 'chat');
    assert.equal(slugFor('你好'), 'chat');
    assert.equal(slugFor(''), 'chat');
  });

  it('sentinel slug composes with dedupe (two unsluggable titles stay unique)', () => {
    const s = dedupeSlug('chat', new Set(['chat']));
    assert.notEqual(s, 'chat');
    assert.ok(s.startsWith('chat-'));
  });

  it('dedupes a colliding slug with a short suffix', () => {
    const taken = new Set(['ley-de-vivienda']);
    const s = dedupeSlug('ley-de-vivienda', taken);
    assert.notEqual(s, 'ley-de-vivienda');
    assert.ok(s.startsWith('ley-de-vivienda-'));
  });

  it('sorts conversations newest-first', () => {
    const a = { updated: 1 }, b = { updated: 2 };
    assert.deepEqual(sortByRecency([a, b]), [b, a]);
  });

  it('reads the slug from a route under the base', () => {
    assert.equal(slugFromRoute('/assistant/contratos-de-alquiler/', '/assistant/'), 'contratos-de-alquiler');
  });

  it('returns empty for the bare base route (fresh entry state)', () => {
    assert.equal(slugFromRoute('/assistant/', '/assistant/'), '');
    assert.equal(slugFromRoute('/assistant', '/assistant/'), ''); // missing trailing slash
  });

  it('keeps only the first segment of a deeper tail', () => {
    assert.equal(slugFromRoute('/assistant/my-convo/extra/', '/assistant/'), 'my-convo');
  });

  it('throws when the route is not under the base (call-site bug, not a guess)', () => {
    assert.throws(() => slugFromRoute('/other/x/', '/assistant/'));
  });
});

describe('toWireTurns', () => {
  it('maps to EXACTLY { role, content }, stripping sources off assistant turns', () => {
    const history = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a [1]', sources: [{ n: 1, title: 'doc-a.md' }] },
    ];
    assert.deepEqual(toWireTurns(history), [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a [1]' },
    ]);
  });

  it('leaves user turns untouched and never adds a sources key', () => {
    const out = toWireTurns([{ role: 'user', content: 'hi' }]);
    assert.deepEqual(out, [{ role: 'user', content: 'hi' }]);
    assert.ok(!('sources' in out[0]));
  });

  it('throws on a non-array (call-site bug, not a guess)', () => {
    assert.throws(() => toWireTurns(null));
  });
});

describe('toStoredTurns', () => {
  it('keeps sources on an assistant turn, drops nothing else', () => {
    const sources = [{ n: 1, title: 'doc-a.md' }, { n: 2, title: 'doc-b.md' }];
    const history = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a [1] [2]', sources },
    ];
    assert.deepEqual(toStoredTurns(history), [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a [1] [2]', sources },
    ]);
  });

  it('user turns never carry a sources key even if one slipped in', () => {
    const out = toStoredTurns([{ role: 'user', content: 'q', sources: [{ n: 1, title: 'x' }] }]);
    assert.deepEqual(out, [{ role: 'user', content: 'q' }]);
    assert.ok(!('sources' in out[0]));
  });

  it('an assistant turn with no sources stores no sources key (legacy/no-citation)', () => {
    const out = toStoredTurns([{ role: 'assistant', content: 'plain reply' }]);
    assert.deepEqual(out, [{ role: 'assistant', content: 'plain reply' }]);
    assert.ok(!('sources' in out[0]));
  });

  it('throws on a non-array (call-site bug, not a guess)', () => {
    assert.throws(() => toStoredTurns(undefined));
  });
});
