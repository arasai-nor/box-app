// BOX service worker — ļauj instalēt aplikāciju un ātri atvērt to.
// Dati vienmēr tiek ņemti no tīkla; kešā tikai aplikācijas faili.
const VERSION = 'box-v1.3.0';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/config.js', 'js/api-demo.js', 'js/api-supabase.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase u.c. — bez keša
  e.respondWith(
    fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

// 2. posms: push paziņojumi (atgādinājumi par rezervāciju beigām u.c.)
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'BOX', body: '' };
  e.waitUntil(self.registration.showNotification(d.title || 'BOX', { body: d.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow('./#/')); });
