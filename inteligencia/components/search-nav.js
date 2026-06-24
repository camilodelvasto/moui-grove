/** search-nav.js — the palette's pure index step.
 *
 * Given the current active index, the option count, and a direction, return
 * the next active index with wrap-around. The only piece of the palette's
 * keyboard nav that is pure logic (no DOM), so it carries a `node --test`;
 * the rest (focus, aria, render) is DOM and verified by the manual checklist.
 *
 * @param {number} current  current active index (-1 when none active).
 * @param {number} count    number of options (caller guarantees > 0).
 * @param {'up'|'down'} dir  navigation direction.
 * @returns {number} the next active index in [0, count).
 */
export function nextIndex(current, count, dir) {
  if (dir === 'down') return (current + 1) % count;
  if (dir === 'up') return current <= 0 ? count - 1 : current - 1;
  throw new Error('nextIndex: unknown direction ' + dir);
}
