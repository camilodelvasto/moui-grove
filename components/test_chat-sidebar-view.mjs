import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { listViewModel } from './chat-sidebar-view.js';

describe('chat-sidebar-view', () => {
  const recs = [
    { slug: 'b', title: 'Beta', updated: 2 },
    { slug: 'a', title: 'Alpha', updated: 1 },
  ];

  it('maps records to { slug, title, active }, preserving order', () => {
    const vm = listViewModel(recs, null);
    assert.deepEqual(vm, [
      { slug: 'b', title: 'Beta', active: false },
      { slug: 'a', title: 'Alpha', active: false },
    ]);
  });

  it('marks the active slug only', () => {
    const vm = listViewModel(recs, 'a');
    assert.equal(vm.find((i) => i.slug === 'a').active, true);
    assert.equal(vm.find((i) => i.slug === 'b').active, false);
  });

  it('marks nothing active when activeSlug is null', () => {
    assert.ok(listViewModel(recs, null).every((i) => i.active === false));
  });

  it('returns an empty list for an empty store', () => {
    assert.deepEqual(listViewModel([], null), []);
    assert.deepEqual(listViewModel([], 'a'), []);
  });

  it('throws on a non-array records input (no defaulting)', () => {
    assert.throws(() => listViewModel(null, null), /records must be an array/);
    assert.throws(() => listViewModel(undefined, 'a'), /records must be an array/);
  });
});
