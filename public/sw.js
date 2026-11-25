// ModernQUAKE service worker: the game opens with no connection once it has been played online once.
//  - pages: network first (so a new build is picked up), falling back to the saved copy when offline
//  - game files (hashed scripts, textures, models, fonts, icons): saved on first use, then served from the saved copy
// Online rooms, the open-games list and the version check always go to the network.
const VER = 'mq-sw-1';
const STATIC = /^\/(assets|chars|kit|tex-alien|tex-lo|fonts)\/|^\/(icon-|apple-touch|menu-bg|manifest)/;

self.addEventListener('install', e => { e.waitUntil(caches.open(VER).then(c => c.addAll(['/', '/manifest.webmanifest']).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api') || u.pathname === '/version.json' || u.pathname === '/ws') return;
  if (r.mode === 'navigate' || u.pathname === '/' || u.pathname.endsWith('.html')) {
    e.respondWith(fetch(r).then(res => { const copy = res.clone(); caches.open(VER).then(c => c.put('/', copy)); return res; }).catch(() => caches.match('/').then(m => m || new Response('Offline', { status: 503 }))));
    return;
  }
  if (STATIC.test(u.pathname)) {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).then(res => { if (res.ok) { const copy = res.clone(); caches.open(VER).then(c => c.put(r, copy)); } return res; })));
  }
});
