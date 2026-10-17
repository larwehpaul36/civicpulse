// Run: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { metersBetween, parseIssueId, otherEnd, linksOf, suggestions } from '../lib/relatedIssues.js';

const ID = '3f2a9c1e-7b64-4d0a-9e51-0c8d2b6a4f17';

test('distance: about 111 m per 0.001 degree of latitude, zero for the same point', () => {
  assert.equal(metersBetween(5.6, -0.19, 5.6, -0.19), 0);
  const d = metersBetween(5.6, -0.19, 5.601, -0.19);
  assert.ok(d > 110 && d < 112, `got ${d}`);
});

test('parseIssueId accepts a bare id, a page address, and mixed case; rejects other text', () => {
  assert.equal(parseIssueId(ID), ID);
  assert.equal(parseIssueId(`https://civicpulse.example/issues/${ID}?x=1`), ID);
  assert.equal(parseIssueId(`  ${ID.toUpperCase()}  `), ID);
  assert.equal(parseIssueId('not an id'), null);
  assert.equal(parseIssueId(''), null);
  assert.equal(parseIssueId(undefined), null);
});

test('otherEnd and linksOf work whichever column holds the id', () => {
  const links = [{ issue_a: 'a', issue_b: 'b' }, { issue_a: 'c', issue_b: 'a' }, { issue_a: 'x', issue_b: 'y' }];
  assert.deepEqual(linksOf(links, 'a').map((l) => otherEnd(l, 'a')).sort(), ['b', 'c']);
});

const at = (id, lat, lng, extra = {}) => ({ id, category_id: 'gutter', status: 'reported', lat, lng, ...extra });

test('suggestions: same type, within range, nearest first, not self', () => {
  const me = at('me', 5.6, -0.19);
  const all = [
    me,
    at('far', 5.61, -0.19),                          // ~1.1 km
    at('near', 5.6005, -0.19),                       // ~55 m
    at('nearer', 5.6002, -0.19),                     // ~22 m
    at('other-type', 5.6001, -0.19, { category_id: 'light' }),
  ];
  const result = suggestions(me, all, []);
  assert.deepEqual(result.map((r) => r.issue.id), ['nearer', 'near']);
  assert.ok(result[0].meters < result[1].meters);
});

test('suggestions skip rejected and already linked reports, and respect the limit', () => {
  const me = at('me', 5.6, -0.19);
  const all = [me, at('rej', 5.6001, -0.19, { status: 'rejected' }), at('linked', 5.6002, -0.19), at('ok', 5.6003, -0.19)];
  const links = [{ issue_a: 'linked', issue_b: 'me' }];
  assert.deepEqual(suggestions(me, all, links).map((r) => r.issue.id), ['ok']);
  const many = [me, ...Array.from({ length: 9 }, (_, n) => at(`n${n}`, 5.6 + n * 0.00001, -0.19))];
  assert.equal(suggestions(me, many, [], { max: 3 }).length, 3);
});

test('suggestions tolerate missing coordinates', () => {
  const me = at('me', 5.6, -0.19);
  assert.deepEqual(suggestions(at('x', null, null), [me], []), []);
  assert.deepEqual(suggestions(me, [me, at('nolocation', undefined, undefined)], []), []);
});
