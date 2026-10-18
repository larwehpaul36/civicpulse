import test from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../lib/newId.js';

test('newId returns unique v4 UUIDs, with or without crypto.randomUUID', () => {
  const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(newId(), re);
  const real = globalThis.crypto.randomUUID;
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
  try {
    const ids = new Set(Array.from({ length: 200 }, newId));
    assert.equal(ids.size, 200);
    ids.forEach((id) => assert.match(id, re));
  } finally {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: real, configurable: true });
  }
});
