import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { precheckAttachment, verifyFile, sha256Hex, base64ToBytes } from './chat-attach-core.js';

const POLICY = { accept: ['image'], max_count: 2, max_bytes: 1000 };

describe('precheckAttachment', () => {
  it('accepts an in-policy image', () => {
    assert.equal(precheckAttachment({ size: 500, type: 'image/png' }, POLICY, 0), null);
  });
  it('rejects oversize', () => {
    assert.equal(precheckAttachment({ size: 5000, type: 'image/png' }, POLICY, 0), 'too_large');
  });
  it('rejects a non-image type', () => {
    assert.equal(precheckAttachment({ size: 10, type: 'application/pdf' }, POLICY, 0), 'wrong_type');
  });
  it('rejects when the conversation is at max_count', () => {
    assert.equal(precheckAttachment({ size: 10, type: 'image/png' }, POLICY, 2), 'too_many');
  });
});

describe('verifyFile', () => {
  it('posts bytes to /verify and returns a content-addressed attachment', async () => {
    const canonical = new Uint8Array([1, 2, 3, 4]);
    const b64 = Buffer.from(canonical).toString('base64');
    let seen;
    const fetchImpl = async (url, opts) => {
      seen = { url, opts };
      return { ok: true, json: async () => ({ data: b64, signature: 'sig', media_type: 'image/webp', bytes: 4 }) };
    };
    const att = await verifyFile({ endpoint: 'https://box/', ask: 'read',
      bytes: canonical, mediaType: 'image/jpeg', secret: 'tok', fetchImpl });
    assert.equal(seen.url, 'https://box/verify/read');
    assert.equal(seen.opts.headers['Authorization'], 'Bearer tok');
    assert.equal(seen.opts.headers['Content-Type'], 'image/jpeg');
    assert.equal(att.signature, 'sig');
    assert.equal(att.media_type, 'image/webp');
    assert.equal(att.data, b64);
    assert.equal(att.id, await sha256Hex(base64ToBytes(b64)));   // content address
  });

  it('throws with .status on a non-OK response', async () => {
    const fetchImpl = async () => ({ ok: false, status: 413, json: async () => ({}) });
    await assert.rejects(
      verifyFile({ endpoint: 'https://box', ask: 'read', bytes: new Uint8Array([0]),
        mediaType: 'image/png', secret: null, fetchImpl }),
      (e) => e.status === 413);
  });
});
