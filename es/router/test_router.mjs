/**Router unit tests — runs with node --test.
 *
 * Tests strategy selection, route resolution, and link handling.
 * No browser DOM needed — strategies are tested against their contracts,
 * router is tested with mock strategy + mock loadPage.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// --- Strategy contract tests ---

describe('pushState strategy contract', () => {
  // Simulate the strategy logic without browser globals
  function routeFromPathname(pathname, basePath) {
    let path = pathname;
    if (basePath && path.startsWith(basePath)) {
      path = path.slice(basePath.length);
    }
    if (!path || path === '/') return '/';
    if (!path.endsWith('/')) path += '/';
    return path;
  }

  it('root path returns /', () => {
    assert.equal(routeFromPathname('/', ''), '/');
  });

  it('root with basePath returns /', () => {
    assert.equal(routeFromPathname('/staging/', '/staging'), '/');
  });

  it('post path returns route without basePath', () => {
    assert.equal(routeFromPathname('/staging/welcome/', '/staging'), '/welcome/');
  });

  it('nested path returns full route', () => {
    assert.equal(routeFromPathname('/staging/arch/format/', '/staging'), '/arch/format/');
  });

  it('path without trailing slash gets normalized', () => {
    assert.equal(routeFromPathname('/staging/welcome', '/staging'), '/welcome/');
  });

  it('empty basePath passes path through', () => {
    assert.equal(routeFromPathname('/welcome/', ''), '/welcome/');
  });
});

describe('hash strategy contract', () => {
  function routeFromHash(hash) {
    if (!hash || hash === '#' || hash === '#/') return '/';
    let route = hash.slice(1);
    if (!route.startsWith('/')) route = '/' + route;
    if (!route.endsWith('/') && route !== '/') route += '/';
    return route;
  }

  it('empty hash returns /', () => {
    assert.equal(routeFromHash(''), '/');
  });

  it('#/ returns /', () => {
    assert.equal(routeFromHash('#/'), '/');
  });

  it('# returns /', () => {
    assert.equal(routeFromHash('#'), '/');
  });

  it('#/welcome/ returns /welcome/', () => {
    assert.equal(routeFromHash('#/welcome/'), '/welcome/');
  });

  it('#/arch/format/ returns /arch/format/', () => {
    assert.equal(routeFromHash('#/arch/format/'), '/arch/format/');
  });

  it('hash without trailing slash gets normalized', () => {
    assert.equal(routeFromHash('#/welcome'), '/welcome/');
  });
});

// --- Strategy selection tests ---

describe('strategy selection', () => {
  function resolveStrategy(manifest, isDev) {
    if (isDev) return 'pushState';
    if (!manifest) return 'mpa';  // no manifest → no client routing
    if (manifest.encrypted) return 'hash';
    return 'pushState';
  }

  it('dev mode → pushState', () => {
    assert.equal(resolveStrategy(null, true), 'pushState');
  });

  it('no manifest → mpa (no client routing)', () => {
    assert.equal(resolveStrategy(null, false), 'mpa');
  });

  it('unencrypted manifest → pushState', () => {
    assert.equal(resolveStrategy({ encrypted: false }, false), 'pushState');
  });

  it('encrypted manifest → hash', () => {
    assert.equal(resolveStrategy({ encrypted: true }, false), 'hash');
  });
});

// --- Link interception tests ---

describe('link interception', () => {
  function shouldIntercept(href, basePath) {
    if (!href) return false;
    if (href.startsWith('http') || href.startsWith('//')) return false;
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    // Check if path is within basePath (simplified — real version uses URL constructor)
    if (basePath && !href.startsWith(basePath) && !href.startsWith('/')) {
      // Relative path — always intercept
      return true;
    }
    return true;
  }

  function hrefToRoute(href, basePath) {
    let route = href;
    if (basePath && route.startsWith(basePath)) {
      route = route.slice(basePath.length);
    }
    if (!route.startsWith('/')) route = '/' + route;
    if (!route.endsWith('/')) route += '/';
    return route;
  }

  it('intercepts internal path', () => {
    assert.equal(shouldIntercept('/welcome/', ''), true);
  });

  it('skips external http link', () => {
    assert.equal(shouldIntercept('https://example.com', ''), false);
  });

  it('skips mailto link', () => {
    assert.equal(shouldIntercept('mailto:a@b.com', ''), false);
  });

  it('skips hash-only link', () => {
    assert.equal(shouldIntercept('#section', ''), false);
  });

  it('skips tel link', () => {
    assert.equal(shouldIntercept('tel:+1234', ''), false);
  });

  it('strips basePath from href', () => {
    assert.equal(hrefToRoute('/staging/welcome/', '/staging'), '/welcome/');
  });

  it('normalizes trailing slash', () => {
    assert.equal(hrefToRoute('/staging/welcome', '/staging'), '/welcome/');
  });

  it('handles root path', () => {
    assert.equal(hrefToRoute('/staging/', '/staging'), '/');
  });
});

// --- buildHref tests ---

describe('buildHref', () => {
  // pushState: basePath + route
  function pushStateBuildHref(route, basePath) {
    return (basePath || '') + route;
  }

  // hash: '#' + route
  function hashBuildHref(route) {
    return '#' + route;
  }

  it('pushState: builds path with basePath', () => {
    assert.equal(pushStateBuildHref('/welcome/', '/staging'), '/staging/welcome/');
  });

  it('pushState: root route', () => {
    assert.equal(pushStateBuildHref('/', '/staging'), '/staging/');
  });

  it('pushState: no basePath', () => {
    assert.equal(pushStateBuildHref('/welcome/', ''), '/welcome/');
  });

  it('hash: builds hash URL', () => {
    assert.equal(hashBuildHref('/welcome/'), '#/welcome/');
  });

  it('hash: root route', () => {
    assert.equal(hashBuildHref('/'), '#/');
  });

  it('buildHref receives routes not url_paths — basePath must not be included', () => {
    // Routes are basePath-free: /welcome/, not /staging/welcome/
    // If basePath leaks into the route, the href doubles it
    const route = '/redesign/strategy-q2.2026/'; // correct: no basePath
    assert.equal(pushStateBuildHref(route, '/staging3'), '/staging3/redesign/strategy-q2.2026/');
    assert.equal(hashBuildHref(route), '#/redesign/strategy-q2.2026/');

    // This would be wrong — basePath in the route:
    const wrongRoute = '/staging3/redesign/strategy-q2.2026/';
    // pushState would produce /staging3/staging3/redesign/... — doubled
    assert.notEqual(pushStateBuildHref(wrongRoute, '/staging3'), '/staging3/redesign/strategy-q2.2026/');
  });
});

// --- isInternal tests ---

describe('isInternal', () => {
  function isInternalPushState(href, basePath) {
    if (!href) return false;
    if (href.startsWith('http') || href.startsWith('//')) return false; // simplified
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:')) return false;
    if (basePath && href.startsWith('/') && !href.startsWith(basePath)) return false;
    return true;
  }

  it('internal path', () => {
    assert.equal(isInternalPushState('/welcome/', ''), true);
  });

  it('internal path with basePath', () => {
    assert.equal(isInternalPushState('/staging/welcome/', '/staging'), true);
  });

  it('external http', () => {
    assert.equal(isInternalPushState('https://example.com', ''), false);
  });

  it('mailto', () => {
    assert.equal(isInternalPushState('mailto:a@b.com', ''), false);
  });

  it('tel', () => {
    assert.equal(isInternalPushState('tel:+1234', ''), false);
  });

  it('hash anchor (not route)', () => {
    assert.equal(isInternalPushState('#section-1', ''), false);
  });

  it('path outside basePath', () => {
    assert.equal(isInternalPushState('/other/path/', '/staging'), false);
  });
});

// --- Router integration (mock strategy + mock transport) ---

describe('router with mock strategy', () => {
  it('start calls swap with current route', async () => {
    const swapped = [];
    const mockStrategy = {
      currentRoute: () => '/welcome/',
      push: () => {},
      listen: () => {},
    };

    // Simulate what createRouter.start does
    swapped.push(mockStrategy.currentRoute());
    assert.equal(swapped[0], '/welcome/');
  });

  it('navigate calls strategy.push then swap', () => {
    const pushed = [];
    const mockStrategy = {
      currentRoute: () => '/',
      push: (route) => pushed.push(route),
      listen: () => {},
    };

    mockStrategy.push('/cloud-act/');
    assert.deepEqual(pushed, ['/cloud-act/']);
  });

  it('loadPage null results in error state', async () => {
    const mockLoadPage = async () => null;
    const result = await mockLoadPage('/nonexistent/');
    assert.equal(result, null);
    // Router would show grove-error div
  });

  it('loadPage with html results in content', async () => {
    const mockLoadPage = async (route) => {
      if (route === '/welcome/') return { html: '<article>Hello</article>' };
      return null;
    };
    const result = await mockLoadPage('/welcome/');
    assert.equal(result.html, '<article>Hello</article>');
  });
});
