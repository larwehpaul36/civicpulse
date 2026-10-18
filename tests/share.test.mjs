import test from 'node:test';
import assert from 'node:assert/strict';
import { strings as s } from '../lib/strings.js';
import { getShare } from '../lib/shareData.js';
import { reportCard, brandCard } from '../lib/ogCard.js';

test('share text reads well for open, new and fixed reports', () => {
  assert.equal(s.share.line('Pothole', 'verified', 5), 'Pothole: still open after 5 days. Can you confirm it?');
  assert.equal(s.share.line('Pothole', 'reported', 1), 'Pothole: still open after 1 day. Can you confirm it?');
  assert.equal(s.share.line('Pothole', 'reported', 0), 'Pothole: reported today. Can you confirm it?');
  assert.equal(s.share.line('Pothole', 'resolved', 3), 'Pothole: fixed after 3 days.');
  assert.equal(s.share.fixed(0), 'Fixed the same day');
});

test('getShare refuses anything that is not a report id, without touching the network', async () => {
  for (const bad of ['', 'abc', '../../etc/passwd', "1' or '1'='1", undefined]) assert.equal(await getShare(bad), null);
});

test('preview cards carry the public facts and nothing else', () => {
  const d = { id: 'x', category: 'Choked gutter', status: 'sent', days_open: 4, confirmation_count: 3, party: 'Test Assembly', photo: null };
  const json = JSON.stringify(reportCard(d));
  for (const part of ['Choked gutter', 'Sent', 'Test Assembly', 'CivicPulse']) assert.ok(json.includes(part), part);
  assert.ok(!json.includes('lat') && !json.includes('lng'), 'no coordinates on the card');
  assert.ok(JSON.stringify(brandCard()).includes('Their response, in public.'));
});
