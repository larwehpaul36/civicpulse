// A report refused by the speed limit or the Ghana check must stop with a plain message (not retry silently).
// Uses an in-memory queue, so it runs without extra packages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncer, MAX_ATTEMPTS } from '../lib/syncQueue.js';
import { strings } from '../lib/strings.js';

function memQueue(items) {
  const subs = new Set();
  return {
    getAll: async () => items.map((x) => ({ ...x })),
    update: async (id, patch) => { const it = items.find((x) => x.id === id); if (!it) return null; Object.assign(it, patch); return { ...it }; },
    remove: async (id) => { items.splice(items.findIndex((x) => x.id === id), 1); },
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
}
const item = () => ({ id: 'r1', status: 'pending', attempts: 0, nextTryAt: 0, steps: { photo: true }, categoryId: 'c', regionId: 'g', severity: 'low', loc: { lat: 5.6, lng: -0.18 } });
const run = async (err) => {
  const items = [item()];
  const supabase = { storage: { from: () => ({ upload: async () => ({ error: null }) }) }, from: () => ({ insert: async () => ({ error: err }) }) };
  const syncer = createSyncer({ supabase, ensureUser: async () => ({ id: 'u' }), queue: memQueue(items) });
  await syncer.syncAll({ ignoreBackoff: true });
  return items[0];
};

test('speed limit: stops, says why, does not retry on its own', async () => {
  const it = await run({ code: 'CP001', message: 'report_rate_limited' });
  assert.equal(it.status, 'failed'); assert.equal(it.attempts, MAX_ATTEMPTS); assert.equal(it.lastError, strings.spam.errors.rate);
});
test('outside Ghana: stops with its own message', async () => {
  const it = await run({ code: 'CP002', message: 'outside_ghana' });
  assert.equal(it.status, 'failed'); assert.equal(it.lastError, strings.spam.errors.outside);
});
test('an ordinary server error still retries as before', async () => {
  const it = await run({ code: '500', status: 500, message: 'oops' });
  assert.equal(it.status, 'pending');
});
