// Run: npm test
// Checks the service worker's caching rules with a fake Cache API and a fake network.
// It cannot show how a real browser installs or updates the worker: test that by hand (see HANDOVER.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWorker, ORIGIN } from './helpers/swHarness.mjs';

// A small site shaped like the Next.js build: pages name their scripts, and one script names a lazily loaded chunk.
const FILES = {
  '/': { type: 'text/html', body: '<html>FORM <script src="/_next/static/chunks/main.js?dpl=abc"></script><link href="/_next/static/chunks/site.css"></html>' },
  '/offline': { type: 'text/html', body: '<html>OFFLINE PAGE <script src="/_next/static/chunks/main.js"></script></html>' },
  '/issues': { type: 'text/html', body: '<html>ISSUES</html>' },
  '/_next/static/chunks/main.js': { type: 'text/javascript', body: 'load("static/chunks/map-lazy.js")' },
  '/_next/static/chunks/map-lazy.js': { type: 'text/javascript', body: 'import("static/chunks/deeper.js")' },
  '/_next/static/chunks/deeper.js': { type: 'text/javascript', body: 'deep' },
  '/_next/static/chunks/site.css': { type: 'text/css', body: 'body{}' },
  '/icons/icon-192.png': { type: 'image/png', body: 'png' },
};

function network({ down = false, delayMs = 0, log = [] } = {}) {
  const state = { down, delayMs, log };
  const impl = async (href, init) => {
    const url = new URL(href);
    state.log.push(url.href);
    if (state.delayMs && url.pathname === '/') await new Promise((r) => setTimeout(r, state.delayMs));
    if (state.down) throw new TypeError('Failed to fetch');
    if (url.hostname === 'tile.openstreetmap.org') return new Response('tile-bytes', { status: 200 });
    const file = url.origin === ORIGIN ? FILES[url.pathname] : undefined;
    return file ? new Response(file.body, { status: 200, headers: { 'content-type': file.type } }) : new Response('nope', { status: 404 });
  };
  return { impl, state };
}

async function installed(opts) {
  const net = network(opts);
  const sw = loadWorker(net.impl, { timeScale: 100 });
  const install = await sw.dispatch('install');
  assert.deepEqual(await install.failed(), []);
  return { sw, net };
}

test('install saves both pages and every script, including lazily loaded chunks', async () => {
  const { sw } = await installed();
  assert.deepEqual((await sw.caches.open('cp-shell-v1')).urls().sort(), ['/', '/offline']);
  const assets = (await sw.caches.open('cp-assets-v1')).urls().sort();
  assert.deepEqual(assets, [
    '/_next/static/chunks/deeper.js', '/_next/static/chunks/main.js',
    '/_next/static/chunks/map-lazy.js', '/_next/static/chunks/site.css',
  ]);
});

test('install fails (so it is retried) when a page cannot be fetched', async () => {
  const net = network({ down: true });
  const sw = loadWorker(net.impl);
  const install = await sw.dispatch('install');
  assert.equal((await install.failed()).length, 1);
});

test('with no signal the report form opens from the saved copy', async () => {
  const { sw, net } = await installed();
  net.state.down = true;
  const nav = await sw.dispatch('fetch', { request: sw.request('/', { mode: 'navigate' }) });
  assert.equal(nav.handled, true);
  assert.match(await nav.response.text(), /FORM/);
});

test('with no signal other pages show the offline page', async () => {
  const { sw, net } = await installed();
  net.state.down = true;
  const nav = await sw.dispatch('fetch', { request: sw.request('/issues', { mode: 'navigate' }) });
  assert.match(await nav.response.text(), /OFFLINE PAGE/);
});

test('online, other pages come straight from the network and are not saved', async () => {
  const { sw } = await installed();
  const nav = await sw.dispatch('fetch', { request: sw.request('/issues', { mode: 'navigate' }) });
  assert.match(await nav.response.text(), /ISSUES/);
  assert.deepEqual((await sw.caches.open('cp-shell-v1')).urls().sort(), ['/', '/offline']);
});

test('a slow connection shows the saved form after a short wait, then refreshes it', async () => {
  const { sw, net } = await installed();
  FILES['/'].body = '<html>FORM v2 <script src="/_next/static/chunks/main.js"></script></html>';
  net.state.delayMs = 5000; // the fake clock runs 100x faster, so this is a 50 ms wait against a 30 ms limit
  const nav = await sw.dispatch('fetch', { request: sw.request('/', { mode: 'navigate' }) });
  assert.match(await nav.response.text(), /FORM <script/, 'served the old saved copy');
  await nav.settle(); // the background refresh finishes
  await new Promise((r) => setTimeout(r, 20));
  const saved = await (await sw.caches.open('cp-shell-v1')).match('/');
  assert.match(await saved.text(), /FORM v2/, 'cache now holds the new copy');
  FILES['/'].body = '<html>FORM <script src="/_next/static/chunks/main.js?dpl=abc"></script><link href="/_next/static/chunks/site.css"></html>';
});

test('saved scripts are served even with a different ?dpl= query, and with no signal', async () => {
  const { sw, net } = await installed();
  net.state.down = true;
  const r = await sw.dispatch('fetch', { request: sw.request('/_next/static/chunks/main.js?dpl=zzz') });
  assert.equal(r.handled, true);
  assert.match(await r.response.text(), /map-lazy/);
});

test('a script not saved yet is fetched once, saved, then served offline', async () => {
  const { sw, net } = await installed();
  FILES['/_next/static/chunks/new.js'] = { type: 'text/javascript', body: 'new' };
  const first = await sw.dispatch('fetch', { request: sw.request('/_next/static/chunks/new.js') });
  assert.equal(await first.response.text(), 'new');
  await new Promise((r) => setTimeout(r, 10));
  net.state.down = true;
  const again = await sw.dispatch('fetch', { request: sw.request('/_next/static/chunks/new.js') });
  assert.equal(await again.response.text(), 'new');
  delete FILES['/_next/static/chunks/new.js'];
});

test('map tiles are saved when viewed and reused with no signal', async () => {
  const { sw, net } = await installed();
  const req = sw.request('https://tile.openstreetmap.org/16/32768/32768.png', { mode: 'no-cors' });
  const first = await sw.dispatch('fetch', { request: req });
  assert.equal(await first.response.text(), 'tile-bytes');
  await new Promise((r) => setTimeout(r, 10));
  net.state.down = true;
  const again = await sw.dispatch('fetch', { request: req });
  assert.equal(await again.response.text(), 'tile-bytes');
  const unseen = await sw.dispatch('fetch', { request: sw.request('https://tile.openstreetmap.org/16/1/1.png', { mode: 'no-cors' }) });
  assert.equal(unseen.response.type, 'error');
});

test('it leaves alone: the admin desk, non-GET requests, and other sites (Supabase)', async () => {
  const { sw } = await installed();
  const admin = await sw.dispatch('fetch', { request: sw.request('/admin', { mode: 'navigate' }) });
  const post = await sw.dispatch('fetch', { request: sw.request('/', { method: 'POST' }) });
  const api = await sw.dispatch('fetch', { request: sw.request('https://abc.supabase.co/rest/v1/issues', { origin: 'https://abc.supabase.co' }) });
  const rsc = await sw.dispatch('fetch', { request: sw.request('/issues?_rsc=1x') });
  assert.deepEqual([admin.handled, post.handled, api.handled, rsc.handled], [false, false, false, false]);
});

test('activate removes old versions but keeps current caches and tiles', async () => {
  const { sw } = await installed();
  await sw.caches.open('cp-assets-v0');
  await sw.caches.open('cp-tiles-v1');
  await sw.caches.open('someone-elses-cache');
  const act = await sw.dispatch('activate');
  assert.deepEqual(await act.failed(), []);
  assert.deepEqual((await sw.caches.keys()).sort(), ['cp-assets-v1', 'cp-shell-v1', 'cp-tiles-v1', 'someone-elses-cache']);
});

test('CACHE_URLS saves only this site\'s /_next/static files', async () => {
  const { sw } = await installed();
  FILES['/_next/static/chunks/late.js'] = { type: 'text/javascript', body: 'late' };
  const msg = await sw.dispatch('message', { data: { type: 'CACHE_URLS', urls: [
    `${ORIGIN}/_next/static/chunks/late.js`, 'https://evil.test/_next/static/chunks/x.js', `${ORIGIN}/private/data.json`,
  ] } });
  assert.deepEqual(await msg.failed(), []);
  const assets = (await sw.caches.open('cp-assets-v1')).urls();
  assert.ok(assets.includes('/_next/static/chunks/late.js'));
  assert.ok(!assets.some((u) => u.includes('x.js') || u.includes('private')));
  delete FILES['/_next/static/chunks/late.js'];
});

test('a push shows a notification with the sent text and keeps the report address', async () => {
  const { sw } = await installed();
  const push = await sw.dispatch('push', { data: { json: () => ({ title: 'CivicPulse', body: 'A report you follow was marked resolved.', url: '/issues/abc', tag: 'issue-abc' }) } });
  await push.settle();
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, 'CivicPulse');
  assert.equal(sw.shown[0].body, 'A report you follow was marked resolved.');
  assert.equal(sw.shown[0].tag, 'issue-abc');
  assert.equal(sw.shown[0].data.url, '/issues/abc');
});

test('a push with no readable data still shows something and points at My reports', async () => {
  const { sw } = await installed();
  const push = await sw.dispatch('push', { data: { json: () => { throw new SyntaxError('not json'); } } });
  await push.settle();
  assert.equal(sw.shown[0].title, 'CivicPulse');
  assert.equal(sw.shown[0].data.url, '/my');
  const empty = await sw.dispatch('push', {});
  await empty.settle();
  assert.equal(sw.shown.length, 2);
});

test('tapping a notification opens the report, or focuses it if it is already open', async () => {
  const { sw } = await installed();
  let closed = false;
  const note = { close: () => { closed = true; }, data: { url: '/issues/abc' } };
  const first = await sw.dispatch('notificationclick', { notification: note });
  await first.settle();
  assert.equal(closed, true);
  assert.deepEqual(sw.opened, [{ opened: `${ORIGIN}/issues/abc` }]);

  sw.opened.length = 0;
  sw.setOpenWindows([`${ORIGIN}/issues/abc`]);
  const again = await sw.dispatch('notificationclick', { notification: { ...note, close: () => {} } });
  await again.settle();
  assert.deepEqual(sw.opened, [{ focused: `${ORIGIN}/issues/abc` }]);
});

test('a notification can never open another site', async () => {
  const { sw } = await installed();
  const evil = await sw.dispatch('notificationclick', { notification: { close: () => {}, data: { url: 'https://evil.test/phish' } } });
  await evil.settle();
  assert.deepEqual(sw.opened, [{ opened: `${ORIGIN}/my` }]);
});
