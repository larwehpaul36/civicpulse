// Sends queued reports to Supabase. Dependencies are passed in so the same code runs in the
// browser and in tests/syncQueue.test.mjs without a live project.
export const MAX_ATTEMPTS = 5;

// "No signal" and "server busy" are not the report's fault: keep it and try again later.
export function isTransient(err) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const status = Number(err?.status ?? err?.statusCode);
  if (status === 0 || status === 429 || status >= 500) return true;
  return /fetch|network|timeout|timed out|offline|AuthRetryableFetchError/i.test(`${err?.name ?? ''} ${err?.message ?? ''}`);
}

const alreadyExists = (e) => String(e?.statusCode) === '409' || /already exists|duplicate/i.test(e?.message ?? '');
const message = (e) => String(e?.message ?? e ?? 'Unknown error').slice(0, 300);
// 15 s, 30 s, 60 s ... up to 10 minutes between tries after a real failure.
const backoff = (attempts) => Math.min(15000 * 2 ** (attempts - 1), 600000);

export function createSyncer({ supabase, ensureUser, queue }) {
  const listeners = new Set();
  const sent = new Set(); // ids sent during this page visit, so the form can say "sent"
  let running = false;

  const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* a bad listener must not stop syncing */ } });
  queue.subscribe(emit);

  // Each step is saved after it succeeds, so a retry resumes instead of starting over.
  // "Already exists" answers count as success: they mean an earlier try got that far.
  async function sendOne(item, user) {
    if (item.userId && item.userId !== user.id) {
      throw new Error('This report was started under a different anonymous session.');
    }
    const path = `${user.id}/${item.id}-before.jpg`;
    const steps = { ...item.steps };
    const markDone = async (name) => {
      steps[name] = true;
      return (await queue.update(item.id, { steps: { ...steps }, userId: user.id })) !== null;
    };

    if (!steps.photo) {
      const { error } = await supabase.storage.from('issue-photos').upload(path, item.photo, { contentType: 'image/jpeg' });
      if (error && !alreadyExists(error)) throw error;
      if (!(await markDone('photo'))) return false;
    }
    if (!steps.issue) {
      const { error } = await supabase.from('issues').insert({
        id: item.id,
        reporter_id: user.id,
        category_id: item.categoryId,
        region_id: item.regionId,
        severity: item.severity,
        description: item.description || null,
        location: `SRID=4326;POINT(${item.loc.lng} ${item.loc.lat})`,
      });
      if (error && error.code !== '23505') throw error;
      if (!(await markDone('issue'))) return false;
    }
    if (!steps.photoRow) {
      const { error } = await supabase.from('issue_photos').insert({
        issue_id: item.id, kind: 'before', storage_path: path, uploaded_by: user.id,
      });
      if (error && error.code !== '23505') throw error;
      if (!(await markDone('photoRow'))) return false;
    }
    return true;
  }

  async function run(ignoreBackoff) {
    let user = null;
    for (const item of await queue.getAll()) {
      if (item.status !== 'pending') continue;
      if (!ignoreBackoff && item.nextTryAt > Date.now()) continue;
      try {
        user ??= await ensureUser();
        const finished = await sendOne(item, user);
        if (finished) {
          await queue.remove(item.id);
          sent.add(item.id);
        }
      } catch (err) {
        if (isTransient(err)) {
          await queue.update(item.id, { lastError: message(err) });
          break; // the next report would fail the same way
        }
        const attempts = (item.attempts ?? 0) + 1;
        await queue.update(item.id, {
          attempts,
          lastError: message(err),
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          nextTryAt: Date.now() + backoff(attempts),
        });
      }
    }
  }

  // One run at a time: per page, and across tabs where the Web Locks API exists.
  async function syncAll({ ignoreBackoff = false } = {}) {
    if (running) return;
    running = true;
    emit();
    try {
      const locks = globalThis.navigator?.locks;
      if (locks) await locks.request('civicpulse-sync', { ifAvailable: true }, (lock) => (lock ? run(ignoreBackoff) : undefined));
      else await run(ignoreBackoff);
    } finally {
      running = false;
      emit();
    }
  }

  return {
    syncAll,
    retry: async (id) => {
      await queue.update(id, { status: 'pending', attempts: 0, nextTryAt: 0, lastError: null });
      return syncAll({ ignoreBackoff: true });
    },
    discard: (id) => queue.remove(id),
    isRunning: () => running,
    hasSent: (id) => sent.has(id),
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
