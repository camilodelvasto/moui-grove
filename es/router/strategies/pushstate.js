/**pushState URL strategy.
 *
 * Browser URL matches canonical path: moui.io/staging/welcome/
 * Used for unencrypted groves where clean URLs enable OG sharing.
 */

export function createPushStateStrategy(basePath) {
  return {
    name: 'pushState',

    currentRoute() {
      let path = window.location.pathname;
      if (basePath && path.startsWith(basePath)) {
        path = path.slice(basePath.length);
      }
      if (!path || path === '/') return '/';
      if (!path.endsWith('/')) path += '/';
      return path;
    },

    push(route) {
      const url = basePath + route;
      if (window.location.pathname !== url) {
        history.pushState(null, '', url);
      }
    },

    listen(handler) {
      window.addEventListener('popstate', () => handler(this.currentRoute()));
    },

    buildHref(route) {
      return (basePath || '') + route;
    },

    isInternal(href) {
      if (!href) return false;
      if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('data:')) return false;
      // Static files (feed.xml, manifest.json, etc.) — never SPA routes
      const path = href.split('?')[0].split('#')[0];
      if (/\.\w+$/.test(path)) return false;
      if (href.startsWith('http') || href.startsWith('//')) {
        try {
          const url = new URL(href);
          if (url.origin !== window.location.origin) return false;
          return !basePath || url.pathname.startsWith(basePath);
        } catch { return false; }
      }
      // Relative or absolute path — resolve against basePath
      try {
        const url = new URL(href, window.location.origin + (basePath || '') + '/');
        return !basePath || url.pathname.startsWith(basePath);
      } catch { return false; }
    },
  };
}
