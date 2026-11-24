#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Vincent Taverna
# torrent.sh [TORRENT-URL | FILE.torrent | MAGNET] [aria2c options...]
#
# Download a torrent inside an unkernel guest (Alpine or Debian) with aria2:
#
#   curl -fsSL https://raw.githubusercontent.com/vinnymac/unkernel/claude/vigilant-johnson-6zatj5/contrib/torrent/torrent.sh | sh -s -- URL
#
# With no argument it fetches Ubuntu's 24.04 mini ISO (98 MiB, an HTTPS
# tracker), a small test. Files go to ~/Downloads (TORRENT_DIR overrides it).
# The guest reaches peers through the page's Wisp proxy (?wisp=wss://...), so
# the address peers see is that proxy's: the script prints it first. Only
# outbound connections work, and UDP trackers, DHT and trackerless magnet
# links need a page and a proxy that relay UDP (this branch does; a release
# without the relay still downloads from torrents with an HTTP(S) tracker).
set -eu

DEFAULT=https://torrent.ubuntu.com/ubuntu-mini-iso/releases/noble/release/mini-iso/ubuntu-mini-iso-24.04.5-mini-iso-amd64.iso.torrent
src=${1:-$DEFAULT}
[ $# -gt 0 ] && shift
dir=${TORRENT_DIR:-$HOME/Downloads}

sudo=
[ "$(id -u)" = 0 ] || sudo=sudo
if ! command -v aria2c >/dev/null 2>&1; then
	echo "torrent: installing aria2" >&2
	if command -v apk >/dev/null 2>&1; then
		# aria2 is in community, which the image enables on demand.
		if [ -x /etc/kw-apk-enable ]; then $sudo /etc/kw-apk-enable >/dev/null 2>&1 || true; fi
		$sudo apk add aria2 ca-certificates >&2 || {
			rel=$(cut -d. -f1,2 /etc/alpine-release)
			$sudo apk add -X "https://dl-cdn.alpinelinux.org/alpine/v$rel/community" aria2 ca-certificates >&2
		}
	elif command -v apt-get >/dev/null 2>&1; then
		$sudo apt-get update >&2
		$sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends aria2 ca-certificates >&2
	else
		echo "torrent: no apk or apt-get here; install aria2 yourself" >&2
		exit 1
	fi
fi

# What the internet sees: the Wisp proxy's address, or its VPN's.
fetch() { if command -v wget >/dev/null 2>&1; then wget -q -T 15 -O - "$1"; else curl -fsS -m 15 "$1"; fi; }
ip=$(fetch https://api.ipify.org 2>/dev/null || true)
echo "torrent: peers will see ${ip:-an address I could not determine (no network?)}" >&2

mkdir -p "$dir"
# No listening port is reachable from outside, no IPv6, no LAN; stop when done.
exec aria2c --seed-time=0 --bt-enable-lpd=false --disable-ipv6=true \
	--file-allocation=none --summary-interval=30 --console-log-level=warn \
	--bt-tracker-connect-timeout=15 --bt-tracker-timeout=30 \
	--dht-entry-point=router.bittorrent.com:6881 \
	-d "$dir" "$@" "$src"
