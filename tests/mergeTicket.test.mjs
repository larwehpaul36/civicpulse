import test from 'node:test';
import assert from 'node:assert/strict';
import { claimPending, prepareMerge } from '../lib/mergeTicket.js';

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), size: () => m.size }; };
const db = (results) => { const calls = []; return { calls, rpc: async (name, args) => { calls.push([name, args]); return results[name] ?? { data: null, error: null }; } }; };
const NOW = Date.UTC(2026, 10, 5, 12);

test('a ticket is made while the phone is anonymous and kept with the address', async () => {
  const storage = memory(); const supabase = db({ create_merge_ticket: { data: 'secret123', error: null } });
  assert.equal(await prepareMerge({ supabase, storage, now: NOW }, ' Ama@Example.com '), 'ready');
  assert.deepEqual(supabase.calls, [['create_merge_ticket', undefined]]);
  assert.deepEqual(JSON.parse(storage.getItem('civicpulse.mergeTicket')), { ticket: 'secret123', email: 'ama@example.com', at: NOW });
});

test('a phone with no anonymous account has nothing to bring, and that is not an error', async () => {
  const storage = memory(); storage.setItem('civicpulse.mergeTicket', '{"stale":1}');
  for (const message of ['not_anonymous', 'not_signed_in']) {
    assert.equal(await prepareMerge({ supabase: db({ create_merge_ticket: { data: null, error: { message } } }), storage }, 'a@b.co'), 'nothing');
  }
  assert.equal(storage.size(), 0);
});

test('any other failure is reported so the caller can decide', async () => {
  await assert.rejects(prepareMerge({ supabase: db({ create_merge_ticket: { data: null, error: { message: 'boom' } } }), storage: memory() }, 'a@b.co'), /prepare_failed/);
  await assert.rejects(prepareMerge({ supabase: db({ create_merge_ticket: { data: 't', error: null } }), storage: null }, 'a@b.co'), /prepare_failed/);
  const broken = { getItem() {}, removeItem() {}, setItem() { throw new Error('quota'); } };
  await assert.rejects(prepareMerge({ supabase: db({ create_merge_ticket: { data: 't', error: null } }), storage: broken }, 'a@b.co'), /prepare_failed/);
});

async function made(email = 'ama@example.com') {
  const storage = memory();
  await prepareMerge({ supabase: db({ create_merge_ticket: { data: 'secret123', error: null } }), storage, now: NOW }, email);
  return storage;
}

test('signed in to the account the link was sent to: the ticket is handed over once and forgotten', async () => {
  const storage = await made();
  const supabase = db({ claim_merge_ticket: { data: { moved: 3 }, error: null } });
  assert.deepEqual(await claimPending({ supabase, storage, now: NOW + 60_000 }, 'Ama@example.com'), { moved: 3 });
  assert.deepEqual(supabase.calls, [['claim_merge_ticket', { p_ticket: 'secret123' }]]);
  assert.equal(storage.size(), 0);
  assert.equal(await claimPending({ supabase, storage }, 'ama@example.com'), null);
  assert.equal(supabase.calls.length, 1);
});

test('a different account on the same phone never receives the reports', async () => {
  const storage = await made();
  const supabase = db({ claim_merge_ticket: { data: { moved: 9 }, error: null } });
  assert.equal(await claimPending({ supabase, storage, now: NOW }, 'someone.else@example.com'), null);
  assert.equal(supabase.calls.length, 0);
  assert.equal(storage.size(), 1, 'kept in case the right account signs in');
});

test('an old ticket is thrown away without asking the database', async () => {
  const storage = await made(); const supabase = db({});
  assert.equal(await claimPending({ supabase, storage, now: NOW + 25 * 3600_000 }, 'ama@example.com'), null);
  assert.equal(supabase.calls.length, 0);
  assert.equal(storage.size(), 0);
});

test('a ticket the database refuses for good is dropped; a temporary failure keeps it', async () => {
  let storage = await made();
  assert.equal(await claimPending({ supabase: db({ claim_merge_ticket: { data: null, error: { message: 'ticket_invalid' } } }), storage, now: NOW }, 'ama@example.com'), null);
  assert.equal(storage.size(), 0);
  storage = await made();
  assert.equal(await claimPending({ supabase: db({ claim_merge_ticket: { data: null, error: { message: 'Failed to fetch' } } }), storage, now: NOW }, 'ama@example.com'), null);
  assert.equal(storage.size(), 1);
});

test('nothing stored, or storage that is damaged, is simply "nothing to do"', async () => {
  const supabase = db({});
  assert.equal(await claimPending({ supabase, storage: memory() }, 'a@b.co'), null);
  assert.equal(await claimPending({ supabase, storage: null }, 'a@b.co'), null);
  const junk = memory(); junk.setItem('civicpulse.mergeTicket', 'not json');
  assert.equal(await claimPending({ supabase, storage: junk }, 'a@b.co'), null);
  assert.equal(supabase.calls.length, 0);
});
