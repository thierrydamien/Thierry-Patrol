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

On the first device, open SQUAD SYNC and it mints an eight-character code.
On the second device, open SQUAD SYNC, tap **Join a squad**, type that code.
From then on both devices pull on launch and push a few seconds after any
change.

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
Brute force is covered by the code space (~6×10¹¹) plus a 60-requests-per-minute
per-IP limit in the Worker.

If you would rather it were locked down harder, the smallest useful change is a
shared secret header checked in `fetch()` before anything else.
