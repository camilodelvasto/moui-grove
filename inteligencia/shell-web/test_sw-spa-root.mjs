/**Contract test for sw.js _matchesSpaRoot — runs with `node --test`.
 *
 * sw.js is a classic service-worker script (no exports), so this mirrors the
 * router test precedent: the function body is copied verbatim and its contract
 * pinned. Keep this identical to _matchesSpaRoot in sw.js.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function makeMatcher(BASE_PATH, OWNED_SPA_ROOTS) {
  return function _matchesSpaRoot(pathname) {
    for (const root of OWNED_SPA_ROOTS) {
      const abs = BASE_PATH + root;
      const prefix = abs.endsWith('/') ? abs : abs + '/';
      if (pathname === abs || pathname === prefix || pathname.startsWith(prefix)) {
        return prefix;
      }
    }
    return null;
  };
}

describe('_matchesSpaRoot — chat subtree', () => {
  const m = makeMatcher('/inteligencia', ['/estratega', '/audiencias']);

  it('slug under a chat root serves that root page', () => {
    assert.equal(m('/inteligencia/estratega/elecciones-abc123/'),
                 '/inteligencia/estratega/');
  });

  it('bare chat page matches its own page', () => {
    assert.equal(m('/inteligencia/estratega/'), '/inteligencia/estratega/');
  });

  it('second chat root is matched independently', () => {
    assert.equal(m('/inteligencia/audiencias/tipos/'),
                 '/inteligencia/audiencias/');
  });

  it('a non-chat path returns null', () => {
    assert.equal(m('/inteligencia/about/'), null);
  });

  it('a prefix collision does not false-match', () => {
    // /estrategas/ must not match the /estratega root
    assert.equal(m('/inteligencia/estrategas/'), null);
  });
});

describe('_matchesSpaRoot — encrypted grove backward compatibility', () => {
  const m = makeMatcher('/inteligencia', ['/']);

  it('any navigation serves the grove root, as before', () => {
    assert.equal(m('/inteligencia/anything/deep/'), '/inteligencia/');
    assert.equal(m('/inteligencia/'), '/inteligencia/');
  });
});

describe('_matchesSpaRoot — no roots', () => {
  const m = makeMatcher('/inteligencia', []);

  it('returns null when nothing is owned', () => {
    assert.equal(m('/inteligencia/estratega/x/'), null);
  });
});
