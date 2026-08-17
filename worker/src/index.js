/*
 * Thierry Patrol - Squad Sync worker.
 *
 * A key-value store with a lock on the door, and nothing else. It does not
 * know what a pilot is, what an upgrade costs, or which missions exist, which
 * is deliberate: the game changes shape most weeks and this should never need
 * to change with it. Merging and validation happen in the browser.
 *
 *   GET  /save?code=ABCD-EFGH  -> { v:1, pilots:{...} }   ({} if unknown)
 *   PUT  /save?code=ABCD-EFGH  <- { v:1, pilots:{...} }
 *
 * ...and a rendezvous for two devices trying to find each other, so two
 * children in two rooms can fly the same sky:
 *
 *   GET  /room?code=WXYZ&slot=offer  -> { data: "..." }   ({} until written)
 *   PUT  /room?code=WXYZ&slot=offer  <- { data: "..." }
 *
 * A ROOM IS NOT A SAVE, and the separation is deliberate rather than tidy.
 * Rooms are four throwaway characters a seven-year-old reads off a screen and
 * types into a tablet, so their space is small enough to guess; saves hold
 * everything the family has ever flown. They live under a different key
 * prefix, so a room can never land on a squad code however the codes are
 * generated, and they expire in two minutes because a handshake that has not
 * completed by then is not going to.
 *
 * The squad code is the only credential. It is 8 characters from a 30-letter
 * alphabet - about 6e11 combinations - and a wrong guess costs a request, so
 * the rate limit below is what actually makes brute force pointless.
 */

const CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const ROOM_RE = /^[A-Z0-9]{4}$/;
const SLOT_RE = /^(offer|answer|ice-h|ice-g)$/;
const MAX_ROOM = 24 * 1024;       // an SDP blob with its candidates inlined
const ROOM_TTL = 120;             // seconds: long enough to type a code
const MAX_BODY = 512 * 1024;      // a very well-played family is a few KB
const WINDOW_S = 60;
const MAX_PER_WINDOW = 60;        // per IP, per minute

function cors(extra){
  return Object.assign({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  }, extra || {});
}
function json(body, status){
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: cors({ "Content-Type": "application/json", "Cache-Control": "no-store" }),
  });
}
function fail(status, message){ return json({ error: message }, status); }

/**
 * Fixed-window counter in KV. Coarse and slightly leaky under concurrency,
 * which is fine: it exists to make guessing codes expensive, not to meter a
 * paid API.
 */
async function rateLimited(env, ip){
  if(!ip) return false;
  const key = "rl:" + ip + ":" + Math.floor(Date.now() / 1000 / WINDOW_S);
  const n = parseInt(await env.SAVES.get(key) || "0", 10) + 1;
  await env.SAVES.put(key, String(n), { expirationTtl: WINDOW_S * 2 });
  return n > MAX_PER_WINDOW;
}

export default {
  async fetch(request, env){
    if(request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors() });

    const url = new URL(request.url);
    if(url.pathname === "/room"){
      if(await rateLimited(env, request.headers.get("CF-Connecting-IP")))
        return fail(429, "Slow down");
      const room = (url.searchParams.get("code") || "").toUpperCase();
      const slot = url.searchParams.get("slot") || "";
      if(!ROOM_RE.test(room)) return fail(400, "Bad room code");
      if(!SLOT_RE.test(slot)) return fail(400, "Bad slot");
      const rkey = "room:" + room + ":" + slot;
      if(request.method === "GET"){
        const got = await env.SAVES.get(rkey);
        return json(got ? { data: got } : {});
      }
      if(request.method === "PUT"){
        const text = await request.text();
        if(text.length > MAX_ROOM) return fail(413, "Too large");
        await env.SAVES.put(rkey, text, { expirationTtl: ROOM_TTL });
        return json({ ok: true });
      }
      return fail(405, "Method not allowed");
    }
    if(url.pathname !== "/save") return fail(404, "Not found");

    const code = (url.searchParams.get("code") || "").toUpperCase();
    if(!CODE_RE.test(code)) return fail(400, "Bad squad code");

    if(await rateLimited(env, request.headers.get("CF-Connecting-IP"))){
      return fail(429, "Slow down");
    }

    const key = "squad:" + code;

    if(request.method === "GET"){
      const saved = await env.SAVES.get(key);
      return json(saved ? JSON.parse(saved) : { v: 1, pilots: {} });
    }

    if(request.method === "PUT"){
      const len = parseInt(request.headers.get("Content-Length") || "0", 10);
      if(len > MAX_BODY) return fail(413, "Save too large");
      let body;
      try { body = await request.json(); }
      catch(e){ return fail(400, "Not JSON"); }
      if(!body || typeof body !== "object" || typeof body.pilots !== "object" || !body.pilots){
        return fail(400, "Expected { pilots: {...} }");
      }
      const text = JSON.stringify({ v: 1, pilots: body.pilots, at: Date.now() });
      if(text.length > MAX_BODY) return fail(413, "Save too large");
      await env.SAVES.put(key, text);
      return json({ ok: true });
    }

    return fail(405, "Method not allowed");
  },
};
