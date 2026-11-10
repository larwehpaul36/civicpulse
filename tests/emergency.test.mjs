import test from 'node:test';
import assert from 'node:assert/strict';
import { EMERGENCY, needsEmergencyNotice, spaced, telHref } from '../lib/emergency.js';
import { strings } from '../lib/strings.js';

test('every listed number is plain digits, listed once, and has a name on screen', () => {
  const numbers = EMERGENCY.map((e) => e.number);
  assert.equal(new Set(numbers).size, numbers.length);
  for (const e of EMERGENCY) {
    assert.match(e.number, /^\d{3}$|^0\d{9}$/, e.key);
    assert.ok(strings.emergency.names[e.key], `no name for ${e.key}`);
  }
  assert.equal(EMERGENCY[0].number, '112', 'the general number comes first');
});

test('the checked national numbers are present', () => {
  const by = Object.fromEntries(EMERGENCY.map((e) => [e.key, e.number]));
  assert.deepEqual([by.general, by.police, by.fire, by.ambulance], ['112', '191', '192', '193']);
});

test('numbers dial and read well', () => {
  assert.equal(telHref('0302964884'), 'tel:0302964884');
  assert.equal(telHref('112'), 'tel:112');
  assert.equal(spaced('0302964884'), '0302 964 884');
  assert.equal(spaced('112'), '112');
});

test('only open reports marked "Dangerous right now" show the notice', () => {
  for (const status of ['reported', 'verified', 'sent', 'in_progress']) assert.equal(needsEmergencyNotice('hazard', status), true, status);
  assert.equal(needsEmergencyNotice('hazard'), true, 'on the report form there is no status yet');
  for (const status of ['resolved', 'rejected']) assert.equal(needsEmergencyNotice('hazard', status), false, status);
  for (const sev of ['low', 'medium', 'high', undefined]) assert.equal(needsEmergencyNotice(sev, 'sent'), false, String(sev));
});

test('the notice is honest that this app is not an emergency service', () => {
  assert.match(strings.emergency.notService, /not an emergency service/);
});
