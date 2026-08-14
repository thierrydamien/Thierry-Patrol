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
const CACHE = "patrol-v31";

/*
 * The shell, cached at install time.
 *
 * The header above promises the game "works in the car, on a plane, anywhere",
 * and that was only true from the SECOND visit: nothing was cached until it had
 * been fetched once, so a family that installed the game and then drove out of
 * signal got a blank page. Precaching the shell makes the promise true on the
 * first flight. Deliberately shell-only - the 13MB of art and music stay
 * cache-on-first-use, because forcing that down the wire at install would turn
 * "add to home screen" into a several-minute download.
 *
 * Failures here must never block activation: a single 404 in this list would
 * reject the whole addAll and leave the worker uninstalled, which is a far
 * worse outcome than a cold cache.
 */
const SHELL = [
  "./", "./index.html", "./style.css", "./manifest.webmanifest",
  "./src/core.js", "./src/data/config.js", "./src/data/enemies.js",
  "./src/data/missions.js", "./src/data/comms.js", "./src/data/story.js",
  "./src/profile.js", "./src/cloud.js", "./src/audio.js", "./src/haptics.js",
  "./src/fx.js", "./src/skygen.js", "./src/icons.js", "./src/insignia.js",
  "./src/pilotart.js", "./src/shipart.js", "./src/paintjob.js",
  "./src/enemyart.js", "./src/bossart.js", "./src/entities.js",
  "./src/systems.js", "./src/bosses.js", "./src/bossintro.js",
  "./src/render.js", "./src/rewind.js", "./src/input.js", "./src/comms.js",
  "./src/backstage.js", "./src/finale.js", "./src/papadeath.js",
  "./src/sky29.js", "./src/wacky.js", "./src/workshop.js",
  "./src/game.js", "./src/ui.js",
  "./assets/fonts/rajdhani-latin-700-normal.woff2",
];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {}))))
      .catch(() => {})
  );
});

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
  try {
    const fresh = await fetch(req);
    if(fresh && fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch(err){
    /*
     * Offline, and this asset was never cached. The throw used to escape into
     * respondWith, which the page sees as a network error - i.e. an <img> that
     * fires onerror. Answering with a plain 503 instead keeps the failure a
     * normal, retryable HTTP response, which is what the loaders expect.
     */
    const stale = await cache.match(req, { ignoreSearch: true });
    if(stale) return stale;
    return new Response("", { status: 503, statusText: "offline" });
  }
}
