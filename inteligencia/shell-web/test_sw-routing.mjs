/**Contract test for sw.js navigation routing — runs with `node --test`.
 *
 * sw.js is a classic service-worker script (no exports), so — following the
 * router/_matchesSpaRoot test precedent — this mirrors the fetch handler's
 * navigation decision (steps 4→5→6) and pins it. Keep the `route` logic
 * identical to the fetch handler in sw.js.
 *
 * This is the test that would have caught the chat deep-link bug: a subpath
 * grove whose SIBLING_PATHS wrongly contained the root grove ('/') passed
 * every in-scope navigation through step 4, so chat slugs 404'd instead of
 * being served their SPA page by step 6.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of sw.js: _SIBLING_PREFIXES prepends BASE_PATH (siblings are declared
// grove-relative), then the navigation runs step 4 (sibling passthrough) →
// step 5 (exact owned page) → step 6 (SPA root serves its own page).
// Models NAVIGATION requests only — in sw.js steps 4/5/6 all guard on
// e.request.mode === 'navigate'; sub-resource fetches fall through to step 7.
function route(pathname, { BASE_PATH, SIBLING_PATHS, OWNED_PAGES, OWNED_SPA_ROOTS }) {
  const _SIBLING_PREFIXES = SIBLING_PATHS.map(p => BASE_PATH + p);
  const _PAGES = new Set(OWNED_PAGES.map(p => BASE_PATH + p));
  if (_SIBLING_PREFIXES.some(p => pathname.startsWith(p))) return 'passthrough:sibling';
  if (_PAGES.has(pathname)) return 'owned-page';
  for (const root of OWNED_SPA_ROOTS) {
    const abs = BASE_PATH + root;
    const prefix = abs.endsWith('/') ? abs : abs + '/';
    if (pathname === abs || pathname === prefix || pathname.startsWith(prefix)) {
      return 'spa:' + prefix;
    }
  }
  return 'passthrough:network';
}

// The deployed inteligencia grove: a subpath grove with three chat SPA roots
// and — after the sibling fix — no siblings (nothing is nested under it).
const INTELIGENCIA = {
  BASE_PATH: '/inteligencia',
  SIBLING_PATHS: [],
  OWNED_PAGES: ['/', '/archive/', '/estratega/', '/flexible/', '/audiencias/'],
  OWNED_SPA_ROOTS: ['/estratega', '/flexible', '/audiencias'],
};

describe('subpath grove routing (inteligencia)', () => {
  it('a chat conversation slug is served its SPA page (step 6)', () => {
    assert.equal(
      route('/inteligencia/estratega/elecciones-colombia-2026-xyz/', INTELIGENCIA),
      'spa:/inteligencia/estratega/');
  });

  it('the bare chat page is an exact owned page (step 5)', () => {
    assert.equal(route('/inteligencia/estratega/', INTELIGENCIA), 'owned-page');
  });

  it('a slug under a second chat root is served that root (step 6)', () => {
    assert.equal(route('/inteligencia/audiencias/tipos-abc/', INTELIGENCIA),
                 'spa:/inteligencia/audiencias/');
  });
});

describe('the sibling bug this fix prevents', () => {
  it("if '/' leaked into SIBLING_PATHS, every slug would passthrough (404)", () => {
    // Regression witness: the root grove's '/' prefixed by BASE_PATH becomes
    // '/inteligencia/', which matches the whole subtree. The collector fix
    // keeps SIBLING_PATHS empty for a subpath grove, so this never happens.
    const buggy = { ...INTELIGENCIA, SIBLING_PATHS: ['/'] };
    assert.equal(route('/inteligencia/estratega/slug/', buggy), 'passthrough:sibling');
  });
});

describe('root grove still excludes its subpath siblings', () => {
  const ROOT = {
    BASE_PATH: '',
    SIBLING_PATHS: ['/inteligencia/', '/es/'],
    OWNED_PAGES: ['/', '/archive/'],
    OWNED_SPA_ROOTS: [],
  };
  it('a navigation into a subpath grove passes through (step 4)', () => {
    assert.equal(route('/inteligencia/estratega/slug/', ROOT), 'passthrough:sibling');
  });
  it('its own page is still owned', () => {
    assert.equal(route('/archive/', ROOT), 'owned-page');
  });
});
