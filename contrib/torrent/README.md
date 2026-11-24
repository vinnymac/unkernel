# Torrents in an unkernel guest

`torrent.sh` downloads a torrent inside the guest (Alpine or Debian) with
Transmission and stops when it is complete:

```sh
curl -fsSL https://raw.githubusercontent.com/vinnymac/unkernel/claude/vigilant-johnson-6zatj5/contrib/torrent/torrent.sh | sh -s -- URL-OR-MAGNET
```

Without an argument it fetches Ubuntu's 24.04 mini ISO (98 MiB) as a test.
The guest reaches peers through the page's Wisp proxy, so open the page with
`?wisp=wss://HOST/PATH/` pointing at a proxy you run.

## The Wisp proxy (`wisp-fly/`)

`start.sh` and `server.mjs` run [wisp-js](https://github.com/MercuryWorkshop/wisp-js)
on a Fly machine (image `node:24-alpine`, both files in `/app`, command
`sh /app/start.sh`, internal port 8080 behind a TLS + HTTP service on 443):

- `WISP_PATH` (env): a random string. Only `wss://APP.fly.dev/WISP_PATH/` is
  served, so the proxy is not open to anyone who finds the host.
- `WG_CONF` (secret, optional): a WireGuard client config in wg-quick format.
  With it every connection made for the guest, TCP and UDP, leaves through
  that tunnel, with a kill switch; if the tunnel cannot be set up the proxy
  refuses Wisp connections rather than use Fly's address. A config whose line
  breaks were lost when the secret was set is repaired.
- `https://APP.fly.dev/WISP_PATH/status` shows whether the VPN is up, the
  address the internet sees, the tunnel's last handshake and what was found
  in the config (its shape, never its values).

Checked 2026-11-24: the mini ISO from the public swarm, by magnet link (DHT)
and by `.torrent`, in headless Chromium on the page of this branch, through
this proxy with and without a WireGuard exit.
