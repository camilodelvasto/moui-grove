// chat-render.js — pure record→view logic, no DOM. The third dumb renderer of
// the run_ask record (after the CLI and the TUI): rewrite [doc:ref] citation
// markers to per-document numbers in order of first appearance, and collect each
// cited document once, labelled by the record's `name` — which in this batch is
// the source FILENAME (source_name -> doc_id, set by run_ask._attach_names), NOT
// the model-written `tema` title (that enrichment is deferred to a later batch).
// The doc_id anchor below MUST track the engine gate's regex in
// shapes/corpus/access/run_ask.py (_CITE): [0-9a-f]{12}. If they diverge in width
// the gate could validate a marker the renderer won't number.
const CITE = /\[([0-9a-f]{12}):([^\]\s]+)\]/g;

// First grapheme of a name, uppercased — the avatar fallback when there's no
// usable image. Empty/absent name → '' (caller renders no chip).
export function monogram(name) {
  if (!name || typeof name !== 'string') return '';
  return [...name][0].toUpperCase();
}

// Rewrite [<12-hex>:ref] citation markers to ordinal [1],[2] by first-appearance
// order of the doc_id. Pure: depends on the answer text alone — no passages — so it
// works for both a live record (with passages) and a stored answer string (without).
// Returns { answerText, order } where `order` is the doc_ids in numbering order.

export function renumberCitations(answer) {
  const text = answer || '';
  const order = [];
  CITE.lastIndex = 0;
  let m;
  while ((m = CITE.exec(text)) !== null) {
    if (!order.includes(m[1])) order.push(m[1]);
  }
  const number = {};
  order.forEach((doc, i) => { number[doc] = i + 1; });
  const answerText = text.replace(CITE, (_full, doc) => '[' + number[doc] + ']');
  return { answerText, order };
}

export function renderAnswer(record) {
  const passages = record.passages || [];

  const nameByDoc = {};
  for (const p of passages) {
    if (!(p.doc_id in nameByDoc)) nameByDoc[p.doc_id] = p.name;
  }

  const { answerText, order } = renumberCitations(record.answer);
  const sources = order.map((doc, i) => ({ n: i + 1, title: nameByDoc[doc] || doc }));
  return { answerText, sources };
}
