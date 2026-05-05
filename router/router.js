/**Grove router factory — creates a router implementation for registration.
 *
 * The router owns: link interception, route resolution, content swap, transitions.
 * The strategy owns: URL reading/writing (pushState vs hash).
 * The transport owns: content fetching (IDB vs network vs bundle).
 *
 * Components never import this file. They import navigation.js (the contract).
 */

export function createRouter({ strategy, loadPage, basePath, onBeforeNavigate }) {
  if (!strategy) throw new Error('createRouter: strategy required');
  if (!loadPage) throw new Error('createRouter: loadPage required');

  let _started = false;

  async function _swap(route) {
    if (onBeforeNavigate) onBeforeNavigate(route);

    const result = await loadPage(route);

    const main = document.getElementById('main');
    if (!main) return;

    if (!result || !result.html) {
      main.innerHTML = '<div class="grove-error"><p>Content not available — try reloading.</p></div>';
      return;
    }

    if (document.startViewTransition) {
      document.startViewTransition(() => { main.innerHTML = result.html; });
    } else {
      main.innerHTML = result.html;
    }

    window.scrollTo(0, 0);
  }

  function _interceptLinks() {
    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;
      if (anchor.target === '_blank') return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const href = anchor.getAttribute('href');
      if (!strategy.isInternal(href)) return;

      e.preventDefault();

      // Resolve to absolute path, strip basePath to get route
      const url = new URL(href, window.location.origin + (basePath || '') + '/');
      let route = url.pathname;
      if (basePath && route.startsWith(basePath)) {
        route = route.slice(basePath.length);
      }
      if (!route.startsWith('/')) route = '/' + route;
      if (!route.endsWith('/') && route !== '/') route += '/';

      navigate(route);
    });
  }

  function navigate(route) {
    strategy.push(route);
    _swap(route);
  }

  function start() {
    if (_started) return;
    _started = true;
    _interceptLinks();
    strategy.listen((route) => _swap(route));
    _swap(strategy.currentRoute());
  }

  function currentRoute() {
    return strategy.currentRoute();
  }

  function buildHref(route) {
    return strategy.buildHref(route);
  }

  function isInternal(href) {
    return strategy.isInternal(href);
  }

  return { navigate, buildHref, currentRoute, start, isInternal };
}
