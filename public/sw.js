// Haldo Service Worker — offline support + form queue
const CACHE_NAME = 'haldo-v1';
const STATIC_ASSETS = [
  '/',
  '/public/style.css',
  '/public/app.js',
  '/public/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API/forms, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // POST requests (form submissions) — try network, queue if offline
  if (event.request.method === 'POST') {
    event.respondWith(
      fetch(event.request.clone()).catch(async () => {
        // Queue the submission for later
        const body = await event.request.clone().text();
        const pending = JSON.parse(localStorage?.getItem('haldo_pending') || '[]');
        pending.push({
          url: event.request.url,
          body,
          contentType: event.request.headers.get('content-type'),
          timestamp: Date.now(),
        });
        // Store in indexedDB via message to client
        const clients = await self.clients.matchAll();
        clients.forEach(client => {
          client.postMessage({ type: 'QUEUE_SUBMISSION', url: event.request.url, body });
        });
        // Return a synthetic redirect to a "queued" page
        return new Response('', {
          status: 302,
          headers: { 'Location': '/offline-queued' },
        });
      })
    );
    return;
  }

  // GET requests — network first, fall back to cache
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache successful GET responses for static assets
        if (response.ok && (url.pathname.startsWith('/public/') || url.pathname === '/')) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Return offline fallback for HTML pages
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return new Response(`
              <!DOCTYPE html>
              <html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Offline — Haldo</title>
              <style>body{font-family:Inter,sans-serif;background:#e5fff8;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
              .offline{text-align:center;padding:32px}.offline h1{color:#006950;font-size:1.5rem}.offline p{color:#6e7a74}</style>
              </head><body><div class="offline"><h1>You're offline</h1><p>Haldo will sync your submissions when you're back online.</p>
              <p>Any checklists you've already loaded will still work.</p></div></body></html>
            `, { headers: { 'Content-Type': 'text/html' } });
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});
