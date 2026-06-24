import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { renderAnswer, renumberCitations, monogram } from './chat-render.js';

describe('renderAnswer', () => {
  it('rewrites markers to per-document numbers; lists each cited doc once', () => {
    const record = {
      answer: 'A [aaaaaaaaaaaa:r1] and B [bbbbbbbbbbbb:r2] and again [aaaaaaaaaaaa:r9].',
      passages: [
        { doc_id: 'aaaaaaaaaaaa', ref: 'r1', name: 'doc-a.md' },
        { doc_id: 'bbbbbbbbbbbb', ref: 'r2', name: 'doc-b.md' },
        { doc_id: 'aaaaaaaaaaaa', ref: 'r9', name: 'doc-a.md' },
      ],
    };
    const { answerText, sources } = renderAnswer(record);
    assert.equal(answerText, 'A [1] and B [2] and again [1].');
    assert.deepEqual(sources, [{ n: 1, title: 'doc-a.md' }, { n: 2, title: 'doc-b.md' }]);
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

describe('renumberCitations', () => {
  it('renumbers markers by first-appearance order, no passages needed', () => {
    const { answerText, order } = renumberCitations(
      'A [aaaaaaaaaaaa:r1] and B [bbbbbbbbbbbb:r2] and again [aaaaaaaaaaaa:r9].');
    assert.equal(answerText, 'A [1] and B [2] and again [1].');
    assert.deepEqual(order, ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']);
  });

  it('no markers → text unchanged, empty order', () => {
    const { answerText, order } = renumberCitations('plain reply');
    assert.equal(answerText, 'plain reply');
    assert.deepEqual(order, []);
  });

  it('missing/empty answer → empty string, empty order', () => {
    assert.deepEqual(renumberCitations(undefined), { answerText: '', order: [] });
    assert.deepEqual(renumberCitations(''), { answerText: '', order: [] });
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
