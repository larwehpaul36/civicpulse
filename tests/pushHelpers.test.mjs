// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { urlBase64ToUint8Array, isToken } from '../lib/pushHelpers.js';

test('converts a URL-safe base64 key to bytes, with or without padding', () => {
  // "hello" is aGVsbG8= in base64
  assert.deepEqual([...urlBase64ToUint8Array('aGVsbG8')], [104, 101, 108, 108, 111]);
  assert.deepEqual([...urlBase64ToUint8Array('aGVsbG8=')], [104, 101, 108, 108, 111]);
  // URL-safe characters: bytes 251,255,254 are "-__-" in URL-safe base64 ("+//+" in the normal alphabet)
  assert.deepEqual([...urlBase64ToUint8Array('-__-')], [251, 255, 254]);
});

test('a real-length VAPID public key gives 65 bytes (an uncompressed P-256 point)', () => {
  const bytes = Uint8Array.from({ length: 65 }, (_, n) => (n === 0 ? 4 : n * 3));
  const b64 = Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.deepEqual([...urlBase64ToUint8Array(b64)], [...bytes]);
});

test('isToken accepts only a UUID', () => {
  assert.equal(isToken('3f2a9c1e-7b64-4d0a-9e51-0c8d2b6a4f17'), true);
  assert.equal(isToken('3F2A9C1E-7B64-4D0A-9E51-0C8D2B6A4F17'), true);
  for (const bad of ['', null, undefined, 'abc', '3f2a9c1e7b644d0a9e510c8d2b6a4f17', "x'; drop table--", '3f2a9c1e-7b64-4d0a-9e51-0c8d2b6a4f17 ']) {
    assert.equal(isToken(bad), false, String(bad));
  }
});
