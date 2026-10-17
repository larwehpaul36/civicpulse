// CivicPulse service worker: lets the report form open with no signal.
// It never touches Supabase requests, /admin, or anything that is not a GET.
// Bump VERSION when this file's caching rules change; old caches are deleted on activate.
const VERSION = 'v1';
const SHELL = `cp-shell-${VERSION}`; // the report form page and the offline page
const ASSETS = `cp-assets-${VERSION}`; // scripts and styles under /_next/static/
const TILES = 'cp-tiles-v1'; // map tiles the person has already looked at
const PAGES = ['/', '/offline'];
const ASSET_LIMIT = 250;
const TILE_LIMIT = 400;
const HOME_WAIT_MS = 3000; // on a slow connection, show the saved form after this long

// Script and style URLs mentioned in a page's HTML or in a script. Scripts list the chunks they load
// later (the map is one), so we read them too. File names are content-hashed, so the query string is dropped.
function assetUrls(text) {
  const found = new Set();
  for (const m of text.matchAll(/(?:\/_next\/)?(static\/(?:chunks|css|media)\/[^"'\\\s)<>?]+)/g)) found.add(`/_next/${m[1]}`);
  return [...found];
}

// Saves a file if it is not saved yet. Returns its text when it is a script, so callers can look for more files.
async function remember(cache, url) {
  let res = await cache.match(url, { ignoreSearch: true });
  if (!res) {
    res = await fetch(url);
    if (!res.ok) return '';
    await cache.put(url, res.clone());
  }
  return url.endsWith('.js') ? res.text() : '';
}

// Save these files and any further files their scripts load, a few levels deep.
async function rememberAll(cache, urls) {
  const seen = new Set(urls);
  let pending = [...seen];
  for (let depth = 0; depth < 3 && pending.length; depth++) {
    const texts = await Promise.allSettled(pending.map((u) => remember(cache, u)));
    pending = [];
    for (const result of texts) {
      if (result.status !== 'fulfilled') continue;
      for (const u of assetUrls(result.value)) if (!seen.has(u)) { seen.add(u); pending.push(u); }
    }
  }
}

// Cache keys come back oldest first, so the first ones are the ones to drop.
async function trim(name, limit) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((k) => cache.delete(k)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    const assets = await caches.open(ASSETS);
    const wanted = new Set();
    for (const page of PAGES) {
      const res = await fetch(page, { cache: 'reload' });
      if (!res.ok) throw new Error(`Could not save ${page}`); // install is retried on the next visit
      await shell.put(page, res.clone());
      assetUrls(await res.text()).forEach((u) => wanted.add(u));
    }
    await rememberAll(assets, [...wanted]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS, TILES]);
    for (const key of await caches.keys()) if (key.startsWith('cp-') && !keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The page sends the scripts it loaded before this worker took control, so they work offline too.
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_URLS') return;
  const urls = (event.data.urls ?? []).filter((u) => {
    const url = new URL(u, self.location.origin);
    return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/');
  });
  event.waitUntil((async () => {
    const assets = await caches.open(ASSETS);
    await rememberAll(assets, urls);
    await trim(ASSETS, ASSET_LIMIT);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.hostname === 'tile.openstreetmap.org') return event.respondWith(tile(request));
  if (url.origin !== self.location.origin) return; // Supabase and everything else goes straight to the network

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    return event.respondWith(cacheFirst(request, event));
  }
  if (request.mode === 'navigate' && !url.pathname.startsWith('/admin')) {
    return event.respondWith(navigate(request, url, event));
  }
});

async function cacheFirst(request, event) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(request, res.clone()).then(() => trim(ASSETS, ASSET_LIMIT)).catch(() => {});
  }
  return res;
}

async function tile(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request.url, { ignoreVary: true });
  if (hit) return hit;
  try {
    // A CORS request gives a normal response we can cache cheaply; an opaque one counts as megabytes of quota.
    const res = await fetch(request.url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) cache.put(request.url, res.clone()).then(() => trim(TILES, TILE_LIMIT)).catch(() => {});
    return res;
  } catch {
    return Response.error(); // the map shows its grey background; GPS and tapping still work
  }
}

// The report form (/) opens from the saved copy when the network is slow or gone, and refreshes in the background.
// Other pages need live data, so with no signal they get the offline page.
async function navigate(request, url, event) {
  const isHome = url.pathname === '/';
  const network = fetch(request).then((res) => {
    if (isHome && res.ok) caches.open(SHELL).then((c) => c.put('/', res.clone())).catch(() => {});
    return res;
  });
  if (isHome) {
    const saved = await caches.match('/', { cacheName: SHELL });
    if (saved) {
      event.waitUntil(network.catch(() => {})); // let the refresh finish even if we answer early
      return Promise.race([
        network.catch(() => saved),
        new Promise((resolve) => setTimeout(() => resolve(saved), HOME_WAIT_MS)),
      ]);
    }
  }
  try {
    return await network;
  } catch {
    return (await caches.match('/offline', { cacheName: SHELL })) ?? Response.error();
  }
}

// ---- push: show the message the notify function sent, and open the report when it is tapped
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* not JSON: show the default */ }
  event.waitUntil(self.registration.showNotification(data.title || 'CivicPulse', {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag, // a newer update about the same report replaces the older one
    data: { url: data.url || '/my' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  let target = new URL('/my', self.location.origin);
  try {
    const wanted = new URL(event.notification.data?.url || '/my', self.location.origin);
    if (wanted.origin === self.location.origin) target = wanted; // never open another site
  } catch { /* keep /my */ }
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of open) {
      if (client.url === target.href && 'focus' in client) return client.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
