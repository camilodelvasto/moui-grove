// chat-render.js — pure record→view logic, no DOM. The third dumb renderer of the
// run_ask record (after the CLI and the TUI): return the model's answer verbatim and
// append no source list. Whether sources appear is the prompt's business (the
// ${sources} placeholder) — the renderer hardcodes no reference format.

// First grapheme of a name, uppercased — the avatar fallback when there's no
// usable image. Empty/absent name → '' (caller renders no chip).
export function monogram(name) {
  if (!name || typeof name !== 'string') return '';
  return [...name][0].toUpperCase();
}

// The answer exactly as the model wrote it, no renderer-appended source list. Whether
// sources appear is the prompt's business (the ${sources} placeholder) — never hardcoded
// here. `sources` stays in the shape callers expect (always empty ⇒ _appendSources no-ops).
export function renderAnswer(record) {
  return { answerText: (record && record.answer) || '', sources: [] };
}
