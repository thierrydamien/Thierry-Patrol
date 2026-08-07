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
/*
 * Bumping this name purges every older cache on activate. Bump it whenever
 * a deploy MUST be picked up - it is the blunt instrument that guarantees a
 * clean slate.
 */
const CACHE = "patrol-v5";

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
    /*
     * `fetch(req)` alone is NOT network-first in practice: it still consults
     * the browser's own HTTP cache, and GitHub Pages serves code with a
     * ten-minute max-age. So a deploy could be live, this worker could be
     * doing exactly what it says, and the player would still be handed
     * yesterday's JavaScript - which is precisely what happened: a shipped
     * change was invisible on the device for want of one option.
     *
     * `cache: "reload"` forces a real revalidation against the server, which
     * is the only thing that makes "code is network-first" true.
     */
    const fresh = await fetch(new Request(req.url, {
      cache: "reload", credentials: "same-origin", mode: "same-origin",
    }));
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
