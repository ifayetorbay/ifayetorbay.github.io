// Heybe service worker: uygulama kabuğu önbellekte; sayfa önce ağdan gelir (güncelleme hemen görünür),
// internet yoksa önbellekteki sürüm açılır. Supabase istekleri önbelleğe alınmaz.
const CACHE = 'heybe-20261128163115';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/leyo/rig-body.png', './icons/leyo/rig-head.png', './icons/leyo/rig-blink.png', './icons/leyo/rig-wing.png', './icons/leyo/rig-wallet.png', './icons/leyo/rig-coin.png', './icons/leyo/bavul-anim.png', './icons/leyo/ucma-anim.png', './icons/leyo/harita.png', './icons/leyo/sevinc.png', './icons/leyo/dusunme.png', './icons/leyo/uyku.png', './icons/leyo/fis.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, {cache:'no-cache'}).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
