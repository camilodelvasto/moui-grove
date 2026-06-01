// navigation.js — Router contract.
// Registered once at boot via registerNavigation(). Components import
// navigate(), buildHref(), currentRoute(), isInternal() without knowing
// the URL strategy. Same pattern as transport.js.
//
// Calling any function before registration throws — no silent defaults.

let _impl = null;

function _require(method) {
  if (!_impl) throw new Error('Navigation not registered. Call registerNavigation() before using navigation functions.');
  return _impl[method];
}

/** Called once by app.js after createRouter(). */
export function registerNavigation(impl) {
  if (_impl) throw new Error('Navigation already registered.');
  const required = ['navigate', 'buildHref', 'currentRoute', 'start', 'isInternal'];
  for (const method of required) {
    if (typeof impl[method] !== 'function') {
      throw new Error(`Navigation implementation missing required method: ${method}`);
    }
  }
  _impl = impl;
}

/** Navigate to a route. Components call this instead of window.location. */
export function navigate(route) { return _require('navigate')(route); }

/** Build an href string for a route — correct for the active URL strategy. */
export function buildHref(route) { return _require('buildHref')(route); }

/** Get the current active route. */
export function currentRoute() { return _require('currentRoute')(); }

/** Start the router — handle initial route, listen for URL changes, intercept links. */
export function start() { return _require('start')(); }

/** Check whether an href is internal to this grove (should be handled by the router). */
export function isInternal(href) { return _require('isInternal')(href); }
