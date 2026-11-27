import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNote, createReporter, messageOf, shouldIgnore } from '../lib/errorReport.js';
import { strings } from '../lib/strings.js';

test('noise is ignored, real errors are not', () => {
  for (const m of ['ResizeObserver loop completed with undelivered notifications.', 'Script error.', 'TypeError: Failed to fetch', 'Load failed', 'captcha_unavailable',
    'Loading chunk 42 failed.', 'chrome-extension://abc/inject.js error']) assert.equal(shouldIgnore(new Error(m)), true, m);
  assert.equal(shouldIgnore(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(shouldIgnore(new Error('x'), { online: false }), true);
  assert.equal(shouldIgnore(''), true);
  assert.equal(shouldIgnore(null), true);
});
test('message extraction handles errors, strings and rejection events', () => {
  assert.equal(messageOf(new Error('boom')), 'boom');
  assert.equal(messageOf('plain'), 'plain');
  assert.equal(messageOf({ reason: new Error('late') }), 'late');
});
test('the note keeps the path only and cuts long text', () => {
  const n = buildNote('script', Object.assign(new Error('x'.repeat(500)), { stack: 'y'.repeat(2000) }), { path: '/verify?code=SECRET#top', agent: 'a'.repeat(300) });
  assert.equal(n.p_path, '/verify'); assert.equal(n.p_message.length, 300); assert.equal(n.p_stack.length, 800); assert.equal(n.p_agent.length, 120);
  assert.equal(buildNote('script', 'no stack', {}).p_stack, null);
});
test('the same error is sent once per visit, and at most 5 kinds', () => {
  const sent = [];
  const report = createReporter({ send: (n) => sent.push(n), getContext: () => ({ path: '/x' }) });
  assert.equal(report('script', new Error('same')), true);
  assert.equal(report('script', new Error('same')), false);
  for (let i = 0; i < 10; i++) report('script', new Error(`other ${i}`));
  assert.equal(sent.length, 5);
});
test('reporting never throws, even if sending fails', async () => {
  const report = createReporter({ send: () => { throw new Error('send broke'); } });
  assert.equal(report('script', new Error('a')), false);
  const rejecting = createReporter({ send: () => Promise.reject(new Error('rpc down')) });
  assert.equal(rejecting('script', new Error('b')), true);
  await new Promise((r) => setTimeout(r, 10));   // an unhandled rejection here would fail the test run
});
test('offline: nothing is sent', () => {
  const sent = [];
  const report = createReporter({ send: (n) => sent.push(n), getContext: () => ({ online: false }) });
  assert.equal(report('script', new Error('real but offline')), false); assert.equal(sent.length, 0);
});
test('strings exist for the error pages and the tab', () => {
  for (const k of ['title', 'body', 'retry', 'home']) assert.ok(strings.errorPage[k]);
  for (const k of ['render', 'script', 'promise', 'report']) assert.ok(strings.admin.errors.kinds[k]);
  assert.equal(strings.admin.errors.times(1), '1 time'); assert.equal(strings.admin.errors.times(3), '3 times');
});
