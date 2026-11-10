/*
 * Offline support for davidmilov.com. After one visit the portfolio and the Buxori
 * translator work without a network connection.
 *
 *  - install:   caches the page shell and every file of the translator app listed in
 *               /translator/app/precache.json (written by the build)
 *  - hashed files (/translator/app/chunks|assets/…-<hash>.*): cache first, they never change
 *  - everything else on this site: network first, so updates arrive as soon as you are
 *               online, with the cached copy as the offline fallback
 *  - /translator offline: served from the cached index.html (the router reads the URL)
 *
 * Only same-origin GET requests are handled. The optional "similar words" model is
 * downloaded from other hosts on request and is cached by the browser itself, not here.
 */
const CACHE = 'site-v1';
const SHELL = ['/', '/index.html', '/assets/site.css', '/assets/nav.js', '/assets/email-gate.js', '/translator/app/translator.js'];
const HASHED = /^\/translator\/app\/(chunks|assets)\/.+-[A-Za-z0-9_-]{8}\.[a-z0-9]+$/;

async function precache() {
  const cache = await caches.open(CACHE);
  let files = [];
  try {
    const res = await fetch('/translator/app/precache.json', { cache: 'no-store' });
    if (res.ok) files = (await res.json()).files.map((f) => '/translator/app/' + f);
  } catch { /* offline install: runtime caching still applies */ }
  // One file failing (a flaky connection) must not stop the rest from being cached.
  await Promise.all([...SHELL, ...files].map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)));
  // Drop hashed files from earlier builds.
  if (files.length) {
    const keep = new Set(files);
    for (const req of await cache.keys()) {
      const path = new URL(req.url).pathname;
      if (HASHED.test(path) && !keep.has(path)) await cache.delete(req);
    }
  }
}

self.addEventListener('install', (event) => { event.waitUntil(precache().then(() => self.skipWaiting())); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (HASHED.test(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      // The translator is a route of the single page: its shell is index.html.
      if (req.mode === 'navigate') { const shell = await cache.match('/index.html'); if (shell) return shell; }
      throw err;
    }
  })());
});
