import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextIndex } from './search-nav.js';

describe('search-nav nextIndex', () => {
  it('down advances by one', () => {
    assert.equal(nextIndex(0, 3, 'down'), 1);
    assert.equal(nextIndex(1, 3, 'down'), 2);
  });

  it('down wraps from last to first', () => {
    assert.equal(nextIndex(2, 3, 'down'), 0);
  });

  it('down from none (-1) selects the first', () => {
    assert.equal(nextIndex(-1, 3, 'down'), 0);
  });

  it('up retreats by one', () => {
    assert.equal(nextIndex(2, 3, 'up'), 1);
  });

  it('up wraps from first to last', () => {
    assert.equal(nextIndex(0, 3, 'up'), 2);
  });

  it('up from none (-1) selects the last', () => {
    assert.equal(nextIndex(-1, 3, 'up'), 2);
  });

  it('single option: both directions stay on 0', () => {
    assert.equal(nextIndex(0, 1, 'down'), 0);
    assert.equal(nextIndex(0, 1, 'up'), 0);
  });

  it('throws on an unknown direction (call-site bug, not a guess)', () => {
    assert.throws(() => nextIndex(0, 3, 'left'));
  });
});
