# Torrents in an unkernel guest

`torrent.sh` downloads a torrent inside the guest (Alpine or Debian) with
Transmission and stops when it is complete:

```sh
curl -fsSL https://raw.githubusercontent.com/vinnymac/unkernel/claude/vigilant-johnson-6zatj5/contrib/torrent/torrent.sh | sh -s -- URL-OR-MAGNET
```

Without an argument it fetches Ubuntu's 24.04 mini ISO (98 MiB) as a test.
The guest reaches peers through the page's Wisp proxy, so open the page with
`?wisp=wss://HOST/PATH/` pointing at a proxy you run.

Run it again after an interruption (a phone that locked, a closed tab): it
goes on from the pieces it already has. A phone freezes the page whenever the
screen locks or the browser is in the background; `?awake=1` on this branch's
page holds the screen on while the page is shown.

On a page that relays no UDP (a release without this branch's relay) the
script reaches DHT and UDP trackers through an IP tunnel to the proxy below
(ssh over the Wisp connection).

`share.sh [DIR]` gets the files out: it serves `~/Downloads` in the guest with
a list and opens it in the page's Browser window; opened in a new tab from
there, Get reads a file out of the guest and Save keeps it on the device (an
iPhone's share sheet: Save to Files). A browser's own download of a link would
not reach the guest, so the list fetches the file itself; it is in the page's
memory once.

```sh
curl -fsSL https://raw.githubusercontent.com/vinnymac/unkernel/claude/vigilant-johnson-6zatj5/contrib/torrent/share.sh | sh
```

## The Wisp proxy (`wisp-fly/`)

`start.sh` and `server.mjs` run [wisp-js](https://github.com/MercuryWorkshop/wisp-js)
on a Fly machine (image `node:24-alpine`, both files in `/app`, command
`sh /app/start.sh`, internal port 8080 behind a TLS + HTTP service on 443):

- `WISP_PASS` (secret): a password of at least 12 characters (letters,
  digits, `-` and `_`). Only `wss://APP.fly.dev/WISP_PASS/` is served, so
  the proxy is not open to anyone who finds the host. A browser's WebSocket
  cannot send a header, which is why the URL carries it.
- `WG_CONF` (secret, optional): a WireGuard client config in wg-quick format.
  With it every connection made for the guest, TCP and UDP, leaves through
  that tunnel, with a kill switch; if the tunnel cannot be set up the proxy
  refuses Wisp connections rather than use Fly's address. A config whose line
  breaks were lost when the secret was set is repaired.
- `PAGE_REPO`, `PAGE_REF` (env, optional): a git URL and branch whose unkernel
  page is built (on a release kernel, about ten minutes and 1 GiB after every
  start) and served at `/`, so the page and its proxy share an origin.
- `/health`, open to all: whether the server, the VPN, the tunnel endpoint and
  the page are up, and counts of accepted and rejected Wisp connections.
- `https://APP.fly.dev/WISP_PASS/status` shows whether the VPN is up, the
  address the internet sees, the tunnel's last handshake and what was found
  in the config (its shape, never its values).

Checked 2026-11-24: the mini ISO from the public swarm, by magnet link (DHT)
and by `.torrent`, in headless Chromium on the page of this branch, through
this proxy with and without a WireGuard exit.
