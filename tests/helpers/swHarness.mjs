// Runs public/sw.js in a Node sandbox with a fake Cache API, so its caching rules can be tested
// without a browser. `fetchImpl(urlString, init)` plays the network.
import vm from 'node:vm';
import fs from 'node:fs';

export const ORIGIN = 'https://app.test';

class FakeCache {
  constructor() { this.entries = []; }
  find(req, opts = {}) {
    const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
    return this.entries.findIndex((e) => (opts.ignoreSearch ? e.url.origin + e.url.pathname === url.origin + url.pathname : e.url.href === url.href));
  }
  async match(req, opts) { const i = this.find(req, opts); return i < 0 ? undefined : this.entries[i].res.clone(); }
  async put(req, res) {
    const url = new URL(typeof req === 'string' ? req : req.url, ORIGIN);
    const i = this.find(url.href);
    if (i >= 0) this.entries.splice(i, 1);
    this.entries.push({ url, res });
  }
  async keys() { return this.entries.map((e) => ({ url: e.url.href })); }
  async delete(req) { const i = this.find(req); if (i >= 0) this.entries.splice(i, 1); return i >= 0; }
  urls() { return this.entries.map((e) => e.url.pathname); }
}

class FakeCaches {
  constructor() { this.stores = new Map(); }
  async open(name) { if (!this.stores.has(name)) this.stores.set(name, new FakeCache()); return this.stores.get(name); }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
  async match(req, opts = {}) {
    for (const [name, store] of this.stores) {
      if (opts.cacheName && opts.cacheName !== name) continue;
      const hit = await store.match(req);
      if (hit) return hit;
    }
    return undefined;
  }
}

export function loadWorker(fetchImpl, { timeScale = 1 } = {}) {
  const handlers = {};
  const caches = new FakeCaches();
  const shown = []; // notifications the worker displayed
  const opened = []; // windows it opened or focused
  let openWindows = [];
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: async () => {},
    registration: { showNotification: async (title, options) => { shown.push({ title, ...options }); } },
    clients: {
      claim: async () => {},
      matchAll: async () => openWindows,
      openWindow: async (url) => { opened.push({ opened: url }); },
    },
  };
  const toUrl = (input) => new URL(typeof input === 'string' ? input : input.url, ORIGIN).href;
  const sandbox = {
    self, caches, URL, Response, Promise, Set, Error, Array, Math, console,
    fetch: (input, init) => fetchImpl(toUrl(input), init),
    setTimeout: (fn, ms) => setTimeout(fn, ms / timeScale),
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8'), sandbox);

  // Fire a worker event. Returns what it answered with (if anything) and the work it asked to keep alive.
  async function dispatch(type, props = {}) {
    const waits = [];
    let answer;
    const event = { ...props, waitUntil: (p) => waits.push(p), respondWith: (p) => { answer = p; } };
    handlers[type](event);
    return {
      handled: answer !== undefined,
      response: answer !== undefined ? await answer : undefined,
      settle: () => Promise.allSettled(waits),
      waits,
      failed: async () => (await Promise.allSettled(waits)).filter((r) => r.status === 'rejected'),
    };
  }
  const request = (path, { mode = 'cors', method = 'GET', origin = ORIGIN } = {}) => ({ url: new URL(path, origin).href, method, mode });
  return {
    dispatch, caches, request, shown, opened,
    setOpenWindows: (list) => { openWindows = list.map((url) => ({ url, focus: async () => { opened.push({ focused: url }); } })); },
  };
}
