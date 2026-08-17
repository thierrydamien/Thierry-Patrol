# Squad Sync — the Cloudflare Worker

Progress in Thierry Patrol lives in the browser. This Worker is what lets it
follow the pilots to another device: one KV entry per **squad code**, holding
every pilot's save.

It is optional. With no endpoint configured the game is exactly what it was —
offline, one device, no network calls at all.

## What it costs

Nothing. Cloudflare's free tier is 100,000 Worker requests and 1,000 KV writes
a day. Two kids playing hard might use fifty writes.

## Deploying it (about five minutes)

You need a free Cloudflare account. From this `worker/` folder:

```sh
npx wrangler login                          # opens a browser, once
npx wrangler kv namespace create SAVES      # prints an id
```

Paste that id into `wrangler.toml` (replacing `PASTE_YOUR_KV_NAMESPACE_ID_HERE`),
then:

```sh
npx wrangler deploy
```

It prints a URL like `https://thierry-patrol-sync.<your-subdomain>.workers.dev`.
Put that in **`docs/src/cloud.js`**:

```js
const ENDPOINT = "https://thierry-patrol-sync.your-subdomain.workers.dev";
```

Commit, push, done — the SQUAD SYNC button appears on the pilot screen.

## Using it

Nothing to set up. Every device defaults to the household's squad code
(`DEFAULT_CODE` in `docs/src/cloud.js`), so a browser that has never seen the
game before pulls the family's progress on first load. Devices pull on launch
and push a few seconds after any change.

Originally each device minted its own random code, which meant a new iPad
synced to nothing until somebody typed eight characters into it — and losing
the code lost the cloud copy, because there is no account to recover it from.
For a game exactly one family plays, that was a failure mode bought with no
benefit.

**Join another squad** still exists, for putting a device on a private code.

## How it handles two devices at once

Every save is stamped with a time. When the same pilot exists in both places,
the newer record wins — **per pilot**, so Marc finishing a mission on the iPad
never rolls back what Charles just did on the laptop. Each push pulls and
merges first, so the window in which anything can be lost is one request long.

## Security, honestly stated

The squad code is the only credential — whoever has it can read and overwrite
those saves. That is the deliberate trade for a family game: no accounts, no
email addresses, no password for a nine-year-old to forget. What is stored is a
callsign, a ship colour and some scores; there is nothing here worth stealing.

Because the default code ships in a public repo, the key to these saves is
public too — the protection is that nobody has a reason to care, not that it is
hard to find. Brute-forcing a *different* squad is covered by the code space
(~6×10¹¹) plus a 60-requests-per-minute per-IP limit in the Worker.

If you would rather it were locked down harder, the smallest useful change is a
shared secret header checked in `fetch()` before anything else.

## Two devices, one sky

Cross-device co-op needs somewhere for two tablets to swap a WebRTC handshake
before they can talk directly. That is the `/room` endpoint, added alongside
`/save`:

```
GET  /room?code=WXYZ&slot=offer   -> { data: "..." }   ({} until written)
PUT  /room?code=WXYZ&slot=offer   <- the blob
```

Rooms use their own key prefix and expire after two minutes, so a four-letter
room code a child reads out loud can never collide with an eight-character
squad code that holds a family's whole save.

**This needs a deploy to take effect.** From `worker/`:

```
npx wrangler deploy
```

Until then, choosing TWO DEVICES in the game says the sync server needs
updating rather than hanging — everything else, including same-device two
player, works without it.
