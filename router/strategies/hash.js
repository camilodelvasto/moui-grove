/**Hash URL strategy.
 *
 * Browser URL: moui.io/staging/#/welcome/
 * Used for encrypted groves where canonical paths must not exist as files.
 */

export function createHashStrategy(basePath) {
  return {
    name: 'hash',

    currentRoute() {
      const hash = window.location.hash;
      if (!hash || hash === '#' || hash === '#/') return '/';
      let route = hash.slice(1);
      if (!route.startsWith('/')) route = '/' + route;
      if (!route.endsWith('/') && route !== '/') route += '/';
      return route;
    },

    push(route) {
      window.location.hash = '#' + route;
    },

    listen(handler) {
      window.addEventListener('hashchange', () => handler(this.currentRoute()));
    },

    buildHref(route) {
      return '#' + route;
    },

    isInternal(href) {
      if (!href) return false;
      // Hash strategy: only same-origin matters. All paths within origin are internal.
      if (href.startsWith('http') || href.startsWith('//')) {
        try {
          return new URL(href).origin === window.location.origin;
        } catch { return false; }
      }
      if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:')) return false;
      // Hash-only links that aren't our route format
      if (href.startsWith('#') && !href.startsWith('#/')) return false;
      return true;
    },
  };
}
