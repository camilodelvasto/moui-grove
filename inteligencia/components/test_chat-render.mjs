import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAnswer, monogram } from './chat-render.js';

describe('renderAnswer', () => {
  it('returns the answer verbatim and never appends a source list', () => {
    const record = {
      answer: 'A [aaaaaaaaaaaa:r1] and B [bbbbbbbbbbbb:r2].',
      passages: [
        { doc_id: 'aaaaaaaaaaaa', ref: 'r1', name: 'doc-a.md' },
        { doc_id: 'bbbbbbbbbbbb', ref: 'r2', name: 'doc-b.md' },
      ],
    };
    const { answerText, sources } = renderAnswer(record);
    assert.equal(answerText, 'A [aaaaaaaaaaaa:r1] and B [bbbbbbbbbbbb:r2].');  // verbatim
    assert.deepEqual(sources, []);                                            // never hardcoded
  });

  it('no markers → plain answer, no sources', () => {
    const { answerText, sources } = renderAnswer({ answer: 'plain reply', passages: [] });
    assert.equal(answerText, 'plain reply');
    assert.deepEqual(sources, []);
  });

  it('missing answer → empty string, no sources', () => {
    const { answerText, sources } = renderAnswer({ passages: [] });
    assert.equal(answerText, '');
    assert.deepEqual(sources, []);
  });
});

test('monogram → first letter uppercased', () => {
  assert.equal(monogram('asistente'), 'A');
  assert.equal(monogram('Émile'), 'É');
});

test('monogram → empty/absent name yields empty string', () => {
  assert.equal(monogram(''), '');
  assert.equal(monogram(undefined), '');
  assert.equal(monogram(null), '');
});
