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
# magnet links need UDP: a page that relays it (this branch), or else, on a
# page that does not (a release without the relay), the IP tunnel that the
# wisp-fly/ proxy offers: the script then sends all the guest's traffic
# through an ssh tunnel (tun0) inside the Wisp connection. TORRENT_TUNNEL=0
# never tunnels, =1 always does.
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

fetch() { if command -v wget >/dev/null 2>&1; then wget -q -T 15 -O - "$1"; else curl -fsS -m 15 "$1"; fi; }

# Does a UDP datagram to the internet get an answer (a DNS query to 1.1.1.1)?
udp_works() {
	command -v nslookup >/dev/null 2>&1 || return 1
	nslookup -timeout=4 -retry=1 example.com 1.1.1.1 >/dev/null 2>&1
}

# The proxy's tunnel endpoint is its loopback, which it knows as kw-tunnel:
# the page's DNS gives any name an address that the proxy maps back to it.
tunnel() {
	if ip link show tun0 >/dev/null 2>&1 && ping -c 1 -W 3 10.77.0.1 >/dev/null 2>&1; then return 0; fi
	t=$(getent hosts kw-tunnel | awk '{print $1; exit}')
	gw=$(ip route | awk '/^default/ {print $3; exit}')
	[ -n "$t" ] && [ -n "$gw" ] || return 1
	key=$(mktemp)
	fetch "http://$t:2223/key" > "$key" 2>/dev/null && grep -q "PRIVATE KEY" "$key" || { rm -f "$key"; return 1; }
	dns=$(fetch "http://$t:2223/dns" 2>/dev/null || echo 1.1.1.1)
	if ! command -v ssh >/dev/null 2>&1; then
		echo "torrent: installing an ssh client for the tunnel" >&2
		if command -v apk >/dev/null 2>&1; then $sudo apk add openssh-client-default >&2
		else $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends openssh-client >&2; fi
	fi
	$sudo ip route add "$t/32" via "$gw" 2>/dev/null || true
	$sudo ssh -f -N -w 0:0 -p 2222 -i "$key" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
		-o ServerAliveInterval=15 -o ExitOnForwardFailure=yes -o LogLevel=ERROR "root@$t" || { rm -f "$key"; return 1; }
	i=0; until ip link show tun0 >/dev/null 2>&1 || [ $i -ge 10 ]; do sleep 1; i=$((i+1)); done
	$sudo ip addr add 10.77.0.2 peer 10.77.0.1 dev tun0 && $sudo ip link set tun0 mtu 1280 up || return 1
	ping -c 1 -W 5 10.77.0.1 >/dev/null 2>&1 || return 1
	# Everything but the tunnel's own connection now goes through it, names included.
	$sudo ip route del default && $sudo ip route add default dev tun0 || return 1
	echo "nameserver $dns" | $sudo tee /etc/resolv.conf >/dev/null
}

case ${TORRENT_TUNNEL:-auto} in
0) ;;
1) tunnel && echo "torrent: using the proxy's IP tunnel" >&2 || { echo "torrent: the tunnel did not come up" >&2; exit 1; } ;;
*) if udp_works; then :
	elif tunnel; then echo "torrent: this page relays no UDP: using the proxy's IP tunnel" >&2
	else echo "torrent: no UDP here (no DHT, no UDP trackers): only peers from HTTP(S) trackers" >&2; fi ;;
esac

# What the internet sees: the Wisp proxy's address, or its VPN's.
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
