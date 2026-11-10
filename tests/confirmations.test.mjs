import test from 'node:test';
import assert from 'node:assert/strict';
import { getPosition, sendConfirmation } from '../lib/confirmations.js';

// A stand-in Supabase client: each insert gets the next scripted answer, and every call is recorded.
function fakeSupabase(answers) {
  const calls = [];
  return {
    calls,
    from(table) {
      return {
        insert(row) {
          const answer = answers.shift() ?? { error: null, data: null };
          calls.push({ table, row });
          const result = { error: answer.error ?? null, data: answer.data ?? null };
          return Object.assign(Promise.resolve(result), { select: () => ({ maybeSingle: async () => result }) });
        },
      };
    },
  };
}
const ARGS = { issueId: 'i1', userId: 'u1' };

test('the position goes along with the confirmation, and the answer says whether it counted', async () => {
  const db = fakeSupabase([{ data: { counts: true } }, { data: { counts: false } }]);
  assert.deepEqual(await sendConfirmation(db, { ...ARGS, position: { lat: 5.6, lng: -0.19 } }), { counted: true });
  assert.deepEqual(db.calls[0].row, { issue_id: 'i1', user_id: 'u1', lat: 5.6, lng: -0.19 });
  assert.deepEqual(await sendConfirmation(db, { ...ARGS, position: { lat: 5.6, lng: -0.19 } }), { counted: false });
});

test('with no position, nulls are sent and the confirmation is still made', async () => {
  const db = fakeSupabase([{ data: { counts: false } }]);
  assert.deepEqual(await sendConfirmation(db, { ...ARGS, position: null }), { counted: false });
  assert.deepEqual(db.calls[0].row, { issue_id: 'i1', user_id: 'u1', lat: null, lng: null });
});

test('real refusals are passed back untouched (already confirmed, own report, phone check)', async () => {
  for (const error of [{ code: '23505' }, { code: '42501' }, { code: 'PV001', message: 'phone_verification_required' }]) {
    const db = fakeSupabase([{ error }]);
    const r = await sendConfirmation(db, { ...ARGS, position: null });
    assert.equal(r.error, error);
    assert.equal(db.calls.length, 1, 'must not retry a real refusal');
  }
});

test('if the database has no position columns yet (015 not run), it falls back to the plain confirmation', async () => {
  for (const error of [{ code: 'PGRST204', message: "Could not find the 'lat' column of 'confirmations' in the schema cache" }, { code: '42703', message: 'column "lat" of relation "confirmations" does not exist' }]) {
    const db = fakeSupabase([{ error }, {}]);
    assert.deepEqual(await sendConfirmation(db, { ...ARGS, position: { lat: 5.6, lng: -0.19 } }), { counted: true });
    assert.equal(db.calls.length, 2);
    assert.deepEqual(db.calls[1].row, { issue_id: 'i1', user_id: 'u1' });
  }
});

test('the plain fallback still reports its own refusal', async () => {
  const refusal = { code: '23505' };
  const db = fakeSupabase([{ error: { code: 'PGRST204', message: "Could not find the 'counts' column" } }, { error: refusal }]);
  assert.equal((await sendConfirmation(db, { ...ARGS, position: null })).error, refusal);
});

const geo = (impl) => ({ getCurrentPosition: impl });

test('getPosition returns coordinates when the phone gives them', async () => {
  const g = geo((ok) => ok({ coords: { latitude: 5.61, longitude: -0.2 } }));
  assert.deepEqual(await getPosition({ geolocation: g }), { lat: 5.61, lng: -0.2 });
});

test('getPosition returns null when blocked, missing, broken or nonsense, and never throws', async () => {
  assert.equal(await getPosition({ geolocation: geo((_ok, no) => no({ code: 1 })) }), null);
  assert.equal(await getPosition({ geolocation: undefined }), null);
  assert.equal(await getPosition({ geolocation: geo(() => { throw new Error('boom'); }) }), null);
  assert.equal(await getPosition({ geolocation: geo((ok) => ok({ coords: { latitude: NaN, longitude: 1 } })) }), null);
});

test('getPosition gives up when the browser never answers', async () => {
  const started = Date.now();
  assert.equal(await getPosition({ geolocation: geo(() => {}), timeoutMs: 30 }), null);
  assert.ok(Date.now() - started < 2000);
});
