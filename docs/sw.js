/*
 * Offline support. The rule that keeps deployments safe: CODE IS
 * NETWORK-FIRST (index.html, every script, the stylesheet - a deploy is
 * picked up on the next online load, the cache only answers when the network
 * can't), ASSETS ARE CACHE-FIRST (music, sprites, icons - they're immutable
 * in practice and heavy, so they load once and then come from disk forever).
 *
 * So: first visit online caches everything it touches, and after that the
 * game works in the car, on a plane, anywhere.
 */
const CACHE = "patrol-v1";

self.addEventListener("install", e => { self.skipWaiting(); });

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin) return;   // fonts etc: browser default

  const isAsset = url.pathname.includes("/assets/");
  e.respondWith(isAsset ? cacheFirst(req) : networkFirst(req));
});

async function networkFirst(req){
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req);
    if(fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch(err){
    const hit = await cache.match(req, { ignoreSearch: true });
    if(hit) return hit;
    throw err;
  }
}

async function cacheFirst(req){
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if(hit) return hit;
  const fresh = await fetch(req);
  if(fresh && fresh.ok) cache.put(req, fresh.clone());
  return fresh;
}
