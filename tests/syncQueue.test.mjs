// Run: npm test
// Checks the offline queue and sync logic against a stand-in Supabase client (no network).
// It does not prove the real Supabase policies accept these writes; that needs a live run.
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as queue from '../lib/offlineQueue.js';
import { createSyncer, MAX_ATTEMPTS } from '../lib/syncQueue.js';

const USER = { id: 'user-1' };
const networkError = () => Object.assign(new TypeError('Failed to fetch'), {});

function report(id, extra = {}) {
  return {
    id, categoryId: 'cat-1', regionId: 'reg-1', severity: 'medium', description: 'Choked gutter',
    loc: { lat: 5.6037, lng: -0.187 }, photo: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }), ...extra,
  };
}

// Each handler gets the call number (1, 2, ...) and returns an error object or null.
function stub({ upload = () => null, issue = () => null, photoRow = () => null } = {}) {
  const calls = { upload: [], issues: [], photos: [] };
  const supabase = {
    storage: { from: () => ({ upload: async (path, blob, opts) => { calls.upload.push({ path, blob, opts }); return { error: upload(calls.upload.length) }; } }) },
    from: (table) => ({
      insert: async (row) => {
        const list = table === 'issues' ? calls.issues : calls.photos;
        list.push(row);
        return { error: (table === 'issues' ? issue : photoRow)(list.length) };
      },
    }),
  };
  return { supabase, calls };
}

async function clearQueue() {
  for (const item of await queue.getAll()) await queue.remove(item.id);
}

test('happy path: uploads, inserts, then empties the queue', async () => {
  await clearQueue();
  const { supabase, calls } = stub();
  const syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('a'));
  await syncer.syncAll();

  assert.equal(calls.upload[0].path, 'user-1/a-before.jpg');
  assert.equal(calls.upload[0].opts.contentType, 'image/jpeg');
  assert.deepEqual(calls.issues[0], {
    id: 'a', reporter_id: 'user-1', category_id: 'cat-1', region_id: 'reg-1', severity: 'medium',
    description: 'Choked gutter', details: {}, location: 'SRID=4326;POINT(-0.187 5.6037)',
  });
  assert.deepEqual(calls.photos[0], { issue_id: 'a', kind: 'before', storage_path: 'user-1/a-before.jpg', uploaded_by: 'user-1' });
  assert.equal((await queue.getAll()).length, 0);
  assert.equal(syncer.hasSent('a'), true);
});

test('no signal: the report stays queued and no attempt is counted', async () => {
  await clearQueue();
  const { supabase, calls } = stub();
  const syncer = createSyncer({ supabase, ensureUser: async () => { throw networkError(); }, queue });
  await queue.enqueue(report('b'));
  await syncer.syncAll();

  const [item] = await queue.getAll();
  assert.equal(item.status, 'pending');
  assert.equal(item.attempts, 0);
  assert.equal(calls.upload.length, 0);
  assert.equal(syncer.hasSent('b'), false);
});

test('resumes after a drop: the photo is not uploaded twice', async () => {
  await clearQueue();
  const { supabase, calls } = stub({ issue: (n) => (n === 1 ? networkError() : null) });
  const syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('c'));

  await syncer.syncAll(); // photo uploaded, then the issue insert loses signal
  const [mid] = await queue.getAll();
  assert.deepEqual(mid.steps, { photo: true, issue: false, photoRow: false });

  await syncer.syncAll(); // second try finishes
  assert.equal(calls.upload.length, 1);
  assert.equal(calls.issues.length, 2);
  assert.equal(calls.photos.length, 1);
  assert.equal((await queue.getAll()).length, 0);
});

test('"already exists" answers count as success', async () => {
  await clearQueue();
  const { supabase } = stub({
    upload: () => ({ statusCode: '409', message: 'The resource already exists' }),
    issue: () => ({ code: '23505', message: 'duplicate key value' }),
    photoRow: () => ({ code: '23505', message: 'duplicate key value' }),
  });
  const syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('d'));
  await syncer.syncAll();
  assert.equal((await queue.getAll()).length, 0);
  assert.equal(syncer.hasSent('d'), true);
});

test('a real rejection backs off, then is marked failed after the limit; retry works', async () => {
  await clearQueue();
  let reject = true;
  const { supabase, calls } = stub({ issue: () => (reject ? { code: '42501', message: 'new row violates row-level security policy' } : null) });
  const syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('e'));

  await syncer.syncAll();
  let [item] = await queue.getAll();
  assert.equal(item.attempts, 1);
  assert.ok(item.nextTryAt > Date.now(), 'waits before the next automatic try');

  await syncer.syncAll(); // still inside the wait: nothing is sent
  assert.equal(calls.issues.length, 1);

  for (let i = 1; i < MAX_ATTEMPTS; i++) await syncer.syncAll({ ignoreBackoff: true });
  [item] = await queue.getAll();
  assert.equal(item.status, 'failed');
  assert.match(item.lastError, /row-level security/);

  const before = calls.issues.length;
  await syncer.syncAll({ ignoreBackoff: true }); // failed reports are left alone
  assert.equal(calls.issues.length, before);

  reject = false;
  await syncer.retry('e');
  assert.equal((await queue.getAll()).length, 0);
});

test('stops at the first "no signal" so later reports are not attempted', async () => {
  await clearQueue();
  const { supabase, calls } = stub({ upload: () => networkError() });
  const syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('f1'));
  await queue.enqueue(report('f2'));
  await syncer.syncAll();
  assert.equal(calls.upload.length, 1);
  assert.equal((await queue.getAll()).length, 2);
});

test('sends reports oldest first', async () => {
  await clearQueue();
  const { supabase, calls } = stub();
  const syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('g1'));
  await new Promise((r) => setTimeout(r, 5));
  await queue.enqueue(report('g2'));
  await syncer.syncAll();
  assert.deepEqual(calls.issues.map((r) => r.id), ['g1', 'g2']);
});

test('two overlapping syncAll calls send each report once', async () => {
  await clearQueue();
  const { supabase, calls } = stub();
  const syncer = createSyncer({ supabase, ensureUser: async () => { await new Promise((r) => setTimeout(r, 20)); return USER; }, queue });
  await queue.enqueue(report('h'));
  await Promise.all([syncer.syncAll(), syncer.syncAll()]);
  assert.equal(calls.issues.length, 1);
});

test('deleting a report mid-send does not bring it back', async () => {
  await clearQueue();
  let syncer;
  const { supabase } = stub({ upload: () => { queue.remove('i'); return null; } });
  syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('i'));
  await syncer.syncAll();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await queue.getAll()).length, 0);
});

test('an "Other" report sends the reporter\'s own words; a normal report sends none', async () => {
  await clearQueue();
  const { supabase, calls } = stub();
  const syncer = createSyncer({ supabase, ensureUser: async () => USER, queue });
  await queue.enqueue(report('o', { otherLabel: 'Fallen tree' }));
  await queue.enqueue(report('n'));
  await syncer.syncAll();
  const row = Object.fromEntries(calls.issues.map((r) => [r.id, r]));
  assert.deepEqual(row.o.details, { other_label: 'Fallen tree' });
  assert.deepEqual(row.n.details, {});
});
