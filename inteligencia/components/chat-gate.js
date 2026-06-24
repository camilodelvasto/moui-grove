// chat-gate.js — pure secret-gate decisions. No DOM, no globals: it must run in
// node --test (same pattern as chat-store.js). The DOM glue in chat.js calls these.
//
// Reframe: a held secret is a credential re-presented every ask, NOT an unlocked
// session. gateView decides input-vs-gate from secret PRESENCE only. askOutcome
// maps one fetch result to a first-class state — every ask is judged on its own.

export function gateView({ hasGate, hasSecret }) {
  if (!hasGate) return 'input';        // open chat: no secret needed
  return hasSecret ? 'input' : 'gate'; // storage first — held secret skips the gate
}

export function askOutcome({ online, threw, status }) {
  if (online === false) return 'offline';
  if (threw) return 'unavailable';     // CORS rejection / timeout — indistinguishable network error
  if (status === 401) return 'revoked';
  if (status === 403) return 'not_permitted';
  if (status === 429) return 'over-limit';
  if (status === 422) return 'refused';
  if (status === 200) return 'answer';
  return 'unavailable';                // 5xx / any unexpected status
}
