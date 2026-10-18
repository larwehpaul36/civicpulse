// Reports waiting to be sent, kept in IndexedDB so they survive closing the app.
// No dependencies, and no Supabase code here: see syncQueue.js for the sending logic.
const DB_NAME = 'civicpulse';
const STORE = 'outbox';

let dbPromise = null;
const listeners = new Set();
let channel = null;

function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function getChannel() {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel('civicpulse-outbox');
  channel.unref?.(); // Node only: do not keep a test process alive
  // Another tab changed the queue: wake our own listeners.
  channel.onmessage = () => listeners.forEach((fn) => fn());
  return channel;
}

function notify() {
  listeners.forEach((fn) => fn());
  getChannel()?.postMessage('changed');
}

export function subscribe(fn) {
  getChannel();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function transaction(mode, work) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let result;
    work(tx.objectStore(STORE), (value) => { result = value; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export function getAll() {
  return transaction('readonly', (store, done) => {
    const req = store.getAll();
    req.onsuccess = () => done(req.result);
  }).then((rows) => (rows ?? []).sort((a, b) => a.createdAt - b.createdAt));
}

export async function enqueue(report) {
  const record = {
    ...report, // id, categoryId, regionId, severity, description, loc, photo (a Blob)
    status: 'pending', // pending | failed
    attempts: 0, // counts real failures only, not "no signal"
    nextTryAt: 0,
    lastError: null,
    userId: null,
    steps: { photo: false, issue: false, photoRow: false },
    createdAt: Date.now(),
  };
  try {
    await transaction('readwrite', (store) => store.put(record));
  } catch (err) {
    // Some Safari versions refuse to store a Blob in IndexedDB. Keep the bytes instead.
    if (typeof Blob === 'undefined' || !(record.photo instanceof Blob)) throw err;
    const bytes = await (record.photo.arrayBuffer ? record.photo.arrayBuffer() : new Response(record.photo).arrayBuffer());
    await transaction('readwrite', (store) => store.put({ ...record, photo: bytes, photoType: record.photo.type || 'image/jpeg' }));
  }
  // Ask the browser not to evict saved reports when storage runs low. Fine if refused.
  navigator.storage?.persist?.().catch(() => {});
  notify();
  return record;
}

// Merge `patch` into a stored report. Returns the merged record, or null if it was deleted.
export async function update(id, patch) {
  const merged = await transaction('readwrite', (store, done) => {
    const req = store.get(id);
    req.onsuccess = () => {
      if (!req.result) return done(null);
      const next = { ...req.result, ...patch };
      store.put(next);
      done(next);
    };
  });
  notify();
  return merged;
}

export async function remove(id) {
  await transaction('readwrite', (store) => store.delete(id));
  notify();
}
