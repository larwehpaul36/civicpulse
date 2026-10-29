import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGhanaPhone, maskPhone } from '../lib/phone.js';

test('Ghana numbers are accepted in the ways people actually type them', () => {
  for (const v of ['024 123 4567', '0241234567', '24 123 4567', '+233 24 123 4567', '233241234567', '(024) 123-4567']) {
    assert.equal(normalizeGhanaPhone(v), '+233241234567', v);
  }
  assert.equal(normalizeGhanaPhone('050 123 4567'), '+233501234567');
});

test('anything that is not a Ghana mobile number is refused', () => {
  for (const v of ['', null, undefined, '12345', '+1 202 555 0100', '0141234567', '024 123 456', '024 123 45678', 'abcdefghi']) {
    assert.equal(normalizeGhanaPhone(v), null, String(v));
  }
});

test('the number is masked when shown back', () => {
  assert.equal(maskPhone('+233241234567'), '+233 24 **** 567');
});
