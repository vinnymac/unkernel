#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Vincent Taverna
# torrent.sh [TORRENT-URL | FILE.torrent | MAGNET] [transmission-cli options...]
#
# Download a torrent inside an unkernel guest (Alpine or Debian) and stop when
# it is complete:
#
#   curl -fsSL https://raw.githubusercontent.com/vinnymac/unkernel/claude/vigilant-johnson-6zatj5/contrib/torrent/torrent.sh | sh -s -- URL
#
# With no argument it fetches Ubuntu's 24.04 mini ISO (98 MiB, an HTTPS
# tracker), a small test. Files go to ~/Downloads (TORRENT_DIR overrides it).
# The guest reaches peers through the page's Wisp proxy (?wisp=wss://...), so
# the address peers see is that proxy's, or its VPN's: the script prints it
# first. Only outbound connections work. UDP trackers, DHT and trackerless
# magnet links need a page and a proxy that relay UDP (this branch and
# wisp-fly/ do); a page without the relay still downloads a torrent that has
# an HTTP(S) tracker, from the peers that tracker names.
#
# The client is Transmission: it bootstraps DHT by itself and keeps a deep
# request queue per peer, where aria2 keeps 6 blocks outstanding and so drops
# to ~50 KiB/s per peer on a path with a long round trip (measured 2026-11-24).
set -eu

DEFAULT=https://torrent.ubuntu.com/ubuntu-mini-iso/releases/noble/release/mini-iso/ubuntu-mini-iso-24.04.5-mini-iso-amd64.iso.torrent
src=${1:-$DEFAULT}
[ $# -gt 0 ] && shift
dir=${TORRENT_DIR:-$HOME/Downloads}

sudo=
[ "$(id -u)" = 0 ] || sudo=sudo
if ! command -v transmission-cli >/dev/null 2>&1; then
	echo "torrent: installing transmission-cli" >&2
	if command -v apk >/dev/null 2>&1; then
		# It is in community, which the image enables on demand.
		if [ -x /etc/kw-apk-enable ]; then $sudo /etc/kw-apk-enable >/dev/null 2>&1 || true; fi
		$sudo apk add transmission-cli ca-certificates >&2 || {
			rel=$(cut -d. -f1,2 /etc/alpine-release)
			$sudo apk add -X "https://dl-cdn.alpinelinux.org/alpine/v$rel/community" transmission-cli ca-certificates >&2
		}
	elif command -v apt-get >/dev/null 2>&1; then
		$sudo apt-get update >&2
		$sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends transmission-cli ca-certificates >&2
	else
		echo "torrent: no apk or apt-get here; install transmission-cli yourself" >&2
		exit 1
	fi
fi

# What the internet sees: the Wisp proxy's address, or its VPN's.
fetch() { if command -v wget >/dev/null 2>&1; then wget -q -T 15 -O - "$1"; else curl -fsS -m 15 "$1"; fi; }
ip=$(fetch https://api.ipify.org 2>/dev/null || true)
echo "torrent: peers will see ${ip:-an address I could not determine (no network?)}" >&2

mkdir -p "$dir"
# transmission-cli seeds until it is stopped: its finish script stops it.
done_sh=$(mktemp)
trap 'rm -f "$done_sh"' EXIT
printf '#!/bin/sh\nkill -INT "$PPID"\n' > "$done_sh"
chmod +x "$done_sh"
# -M: no port mapping (nothing outside can connect in), -u 0: no upload.
transmission-cli -w "$dir" -M -u 0 -f "$done_sh" "$@" "$src" || true
echo
ls -l "$dir"
