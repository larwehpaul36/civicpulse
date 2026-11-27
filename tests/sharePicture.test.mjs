import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isCardPath, pictureName, sharePicture } from '../lib/sharePicture.js';
import { squareCard, SQUARE, reportCard } from '../lib/ogCard.js';
import { strings as s } from '../lib/strings.js';

const ID = '123e4567-e89b-12d3-a456-426614174000';
class FakeFile { constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = opts.type; } }
const png = (size = 10) => ({ type: 'image/png', size });
const okFetch = (blob = png()) => async () => ({ ok: true, blob: async () => blob });
const nav = (over = {}) => { const calls = []; return { calls, canShare: () => true, share: async (a) => { calls.push(a); }, ...over }; };
const base = (o) => ({ fetchImpl: okFetch(), FileCtor: FakeFile, path: `/issues/${ID}/card`, title: 'Pothole', text: 'Pothole: still open. https://x', ...o });

test('sharing a picture attaches the file and puts the link in the text', async () => {
  const n = nav();
  assert.equal(await sharePicture(base({ nav: n })), 'shared');
  assert.equal(n.calls.length, 1);
  assert.equal(n.calls[0].files[0].name, pictureName());
  assert.equal(n.calls[0].files[0].type, 'image/png');
  assert.equal(n.calls[0].text, 'Pothole: still open. https://x');
});

test('a phone that cannot share files is told so, so the picture can be opened and saved', async () => {
  assert.equal(await sharePicture(base({ nav: nav({ canShare: () => false }) })), 'unsupported');
  assert.equal(await sharePicture(base({ nav: { share: async () => {} } })), 'unsupported', 'no canShare');
  assert.equal(await sharePicture(base({ nav: { canShare: () => true } })), 'unsupported', 'no share');
  assert.equal(await sharePicture(base({ nav: undefined })), 'unsupported');
});

test('closing the share sheet is not an error; real errors never throw', async () => {
  const abort = Object.assign(new Error('x'), { name: 'AbortError' });
  assert.equal(await sharePicture(base({ nav: nav({ share: async () => { throw abort; } }) })), 'cancelled');
  assert.equal(await sharePicture(base({ nav: nav({ share: async () => { throw new Error('boom'); } }) })), 'failed');
  assert.equal(await sharePicture(base({ nav: nav(), fetchImpl: async () => { throw new Error('offline'); } })), 'failed');
  assert.equal(await sharePicture(base({ nav: nav(), fetchImpl: async () => ({ ok: false }) })), 'failed');
  assert.equal(await sharePicture(base({ nav: nav(), fetchImpl: okFetch({ type: 'text/html', size: 50 }) })), 'failed', 'an error page is not a picture');
  assert.equal(await sharePicture(base({ nav: nav(), fetchImpl: okFetch(png(0)) })), 'failed', 'empty picture');
});

test('only this site\'s own picture path is ever fetched', () => {
  assert.equal(isCardPath(`/issues/${ID}/card`), true);
  for (const bad of ['', null, undefined, `https://evil.example/issues/${ID}/card`, `//evil.example/issues/${ID}/card`, `/issues/${ID}/card?x=1`, `/issues/${ID}/../card`, '/issues/abc/card', `/issues/${ID}/card/extra`, `/admin/${ID}/card`]) assert.equal(isCardPath(bad), false, String(bad));
});

const find = (node, text) => JSON.stringify(node).includes(text);
const report = { id: ID, category: 'Choked gutter', status: 'sent', days_open: 4, confirmation_count: 3, party: 'Ga East Assembly', photo: null, lat: 5.6, lng: -0.18, description: 'private words', reporter_id: 'u1' };

test('the square picture is square and carries only public facts', () => {
  assert.deepEqual(SQUARE, { width: 1080, height: 1080 });
  const json = JSON.stringify(squareCard(report));
  for (const part of ['Choked gutter', 'Sent', 'Ga East Assembly', 'CivicPulse', s.share.confirmPrompt]) assert.ok(json.includes(part), part);
  for (const secret of ['5.6', '-0.18', 'private words', 'u1', 'lat', 'lng']) assert.ok(!json.includes(secret), `leaked: ${secret}`);
  assert.ok(!find(squareCard(report), s.share.thanks));
});

test('a fixed problem is celebrated, not asked about', () => {
  const card = squareCard({ ...report, status: 'resolved', days_open: 6 });
  assert.ok(find(card, 'Fixed after 6 days') && find(card, s.share.thanks));
  assert.ok(!find(card, s.share.confirmPrompt));
  assert.ok(find(squareCard({ ...report, status: 'resolved', days_open: 0 }), 'Fixed the same day'));
});

test('the picture works with a photo, without one, and without an office', () => {
  const withPhoto = squareCard({ ...report, photo: 'data:image/png;base64,AAAA' });
  assert.ok(find(withPhoto, 'data:image/png;base64,AAAA'));
  assert.ok(!find(squareCard(report), 'data:image'));
  assert.ok(!find(squareCard({ ...report, party: null }), 'Responsible'));
  assert.ok(find(squareCard({ ...report, party: null }), 'Choked gutter'));
  for (const c of [withPhoto, squareCard(report), reportCard(report)]) assert.ok(!/undefined|NaN/.test(JSON.stringify(c)));
});

test('every box in the picture can be drawn by the image maker (each box that holds something is display:flex)', () => {
  const walk = (n, bad = []) => {
    if (n && typeof n === 'object' && n.type) {
      if (n.type === 'div' && n.props.children !== undefined && n.props.style?.display !== 'flex') bad.push(n);   // an empty colour block needs no display
      [].concat(n.props.children ?? []).forEach((c) => walk(c, bad));
    }
    return bad;
  };
  assert.equal(walk(squareCard(report)).length, 0);
  assert.equal(walk(squareCard({ ...report, photo: 'data:image/png;base64,AAAA', status: 'resolved' })).length, 0);
});

test('the report page offers the picture, and the picture route is public-facts only', () => {
  const page = readFileSync(new URL('../app/issues/[id]/page.js', import.meta.url), 'utf8');
  assert.ok(/cardPath=\{`\/issues\/\$\{issue\.id\}\/card`\}/.test(page));
  const route = readFileSync(new URL('../app/issues/[id]/card/route.js', import.meta.url), 'utf8');
  assert.ok(/getShare\(id\)/.test(route) && /squareCard/.test(route) && /brandCard/.test(route), 'unknown report: brand card, never an error page');
  const btn = readFileSync(new URL('../components/ShareButton.js', import.meta.url), 'utf8');
  assert.ok(/isCardPath\(cardPath\)/.test(btn) && /download="civicpulse-report.png"/.test(btn));
  assert.ok(!/ShareButton cardPath/.test(readFileSync(new URL('../app/monthly/page.js', import.meta.url), 'utf8')), 'the monthly page has no picture');
});

test('a very long title or office name is made smaller or shortened, never left to run into the next line', () => {
  const long = squareCard({ ...report, category: 'x'.repeat(200), party: 'y'.repeat(300) });
  const json = JSON.stringify(long);
  assert.ok(!json.includes('x'.repeat(100)) && !json.includes('y'.repeat(100)));
  assert.ok(json.includes('…'));
  const size = (cat) => JSON.stringify(squareCard({ ...report, category: cat })).match(/"fontSize":(\d+),"fontWeight":800,"lineHeight":1.05/)[1];
  assert.equal(size('Pothole'), '84');
  assert.equal(size('Overflowing bin near the lorry'), '68');
  assert.equal(size('Overflowing bin near the lorry station and the big market'), '54');
});
