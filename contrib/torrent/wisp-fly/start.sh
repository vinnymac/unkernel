#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Vincent Taverna
# Wisp server for unkernel on a Fly machine. With the secret WG_CONF (a WireGuard
# client config, wg-quick format) every connection the server makes for the guest,
# TCP and UDP, leaves through that tunnel; without it they leave from Fly directly.
# With a WG_CONF that does not work the server refuses Wisp connections rather
# than fall back to Fly's address. /tmp/vpn-report.txt (shown by the status
# page) describes the config's shape and what failed, never its values.
cd /app || exit 1
[ -d node_modules/@mercuryworkshop/wisp-js ] || npm i --no-audit --no-fund @mercuryworkshop/wisp-js@0.5.3 || exit 1

R=/tmp/vpn-report.txt
say() { echo "$*" >> $R; echo "vpn: $*"; }
# Error text from the tools, with anything that could be a key or an address removed.
scrub() { sed -E 's/[A-Za-z0-9+\/]{20,}=*/<redacted>/g; s/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/<ip>/g; s/`[^`]*`|'"'"'[^'"'"']*'"'"'/<value>/g' | head -5; }

check() {
	f=/tmp/wg-full.conf
	say "config: $(wc -l < $f) lines, $(wc -c < $f) bytes"
	[ "$(wc -l < $f)" -ge 4 ] || say "PROBLEM: fewer than 4 lines: the line breaks were probably lost when the secret was set"
	grep -qiE '^[[:space:]]*\[Interface\][[:space:]]*$' $f || say "PROBLEM: no [Interface] line"
	say "[Peer] sections: $(grep -ciE '^[[:space:]]*\[Peer\][[:space:]]*$' $f)"
	say "keys present: $(sed -nE 's/^[[:space:]]*([A-Za-z]+)[[:space:]]*=.*/\1/p' $f | sort | uniq -c | awk '{printf "%s%s", $2, ($1>1 ? "x"$1" " : " ")}')"
	bad=$(grep -vE '^[[:space:]]*(#.*|\[[A-Za-z]+\]|[A-Za-z]+[[:space:]]*=.*)?[[:space:]]*$' $f | wc -l)
	[ "$bad" = 0 ] || say "PROBLEM: $bad line(s) are neither a [Section], a Key = value nor a comment"
	for k in PrivateKey PublicKey; do
		v=$(val $k | head -1 | tr -d ' ')
		if [ -z "$v" ]; then say "PROBLEM: no $k"
		elif echo "$v" | grep -qE '^[A-Za-z0-9+/]{43}=$'; then say "$k: well-formed"
		else say "PROBLEM: $k is not 44 characters of base64 (it is ${#v} characters)"; fi
	done
	if val Address | tr ' ' '\n' | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$'; then say "Address: has an IPv4 address"; else say "PROBLEM: no IPv4 Address"; fi
	if val Endpoint | grep -qE '^.+:[0-9]+$'; then say "Endpoint: host:port"; else say "PROBLEM: Endpoint is missing or not host:port"; fi
	if val AllowedIPs | tr ' ' '\n' | grep -qx '0.0.0.0/0'; then say "AllowedIPs: includes 0.0.0.0/0"; else say "note: AllowedIPs has no 0.0.0.0/0 (all IPv4 is routed into the tunnel regardless)"; fi
}

val() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//Ip" /tmp/wg-full.conf | sed 's/[[:space:]]*$//' | tr ',' ' '; }

vpn_up() {
	apk add --no-cache wireguard-tools-wg iproute2 iptables >/dev/null 2>&1 || { say "PROBLEM: could not install the WireGuard tools"; return 1; }
	# wg(8) takes only its own keys; the wg-quick ones are applied by hand below.
	grep -viE '^[[:space:]]*(Address|DNS|MTU|Table|PreUp|PostUp|PreDown|PostDown|SaveConfig)[[:space:]]*=' /tmp/wg-full.conf > /tmp/wg0.conf
	ip link add wg0 type wireguard 2>/dev/null || { apk add --no-cache wireguard-go >/dev/null 2>&1; wireguard-go wg0 2>/dev/null; } || { say "PROBLEM: no WireGuard interface"; return 1; }
	e=$(wg setconf wg0 /tmp/wg0.conf 2>&1) || { say "PROBLEM: wg rejected the config: $(echo "$e" | scrub)"; return 1; }
	n=0
	for a in $(val Address); do case $a in *:*) ;; *) ip addr add "$a" dev wg0 2>/dev/null && n=$((n+1)) ;; esac; done   # IPv4 only
	[ $n -gt 0 ] || { say "PROBLEM: no usable IPv4 Address"; return 1; }
	mtu=$(val MTU); ip link set wg0 mtu "${mtu:-1380}" up || return 1
	# Everything goes to the tunnel except the tunnel's own packets (fwmark) and
	# Fly's side of eth0 (its proxy and private network, 172.16.0.0/12).
	wg set wg0 fwmark 51820 &&
	ip route add default dev wg0 table 51820 &&
	ip rule add priority 80 to 172.16.0.0/12 lookup main &&
	ip rule add priority 85 lookup main suppress_prefixlength 0 &&
	ip rule add priority 90 not fwmark 51820 lookup 51820 || { say "PROBLEM: routing setup failed"; return 1; }
	# Kill switch: nothing but the tunnel itself and Fly's side leaves eth0, and no public IPv6 at all.
	iptables -A OUTPUT -o eth0 -m mark --mark 51820 -j ACCEPT &&
	iptables -A OUTPUT -o eth0 -d 172.16.0.0/12 -j ACCEPT &&
	iptables -A OUTPUT -o eth0 -j REJECT || { say "PROBLEM: kill switch setup failed"; return 1; }
	ip6tables -A OUTPUT -d fdaa::/16 -j ACCEPT 2>/dev/null && ip6tables -A OUTPUT -d fe80::/10 -j ACCEPT && ip6tables -A OUTPUT -d ::1 -j ACCEPT \
		&& ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT && ip6tables -A OUTPUT -j REJECT || say "note: no ip6tables, IPv6 is not blocked"
	dns=$(val DNS); : > /etc/resolv.conf
	for d in ${dns:-1.1.1.1 9.9.9.9}; do case $d in *:*|*[a-z]*) ;; *) echo "nameserver $d" >> /etc/resolv.conf ;; esac; done
	[ -s /etc/resolv.conf ] || echo "nameserver 1.1.1.1" > /etc/resolv.conf
	say "tunnel configured"
}

: > $R
if [ -n "$WG_CONF" ]; then
	umask 077
	printf '%s\n' "$WG_CONF" | tr -d '\r' > /tmp/wg-full.conf
	# A secret pasted into a one-line field loses its line breaks: put them back
	# before each [Section] and each known key.
	if [ "$(wc -l < /tmp/wg-full.conf)" -lt 4 ] && grep -q '\[Interface\]' /tmp/wg-full.conf; then
		sed -E 's/[[:space:]]*\[(Interface|Peer)\][[:space:]]*/\n[\1]\n/g; s/[[:space:]]*(PrivateKey|ListenPort|Address|DNS|MTU|Table|PublicKey|PresharedKey|AllowedIPs|Endpoint|PersistentKeepalive)[[:space:]]*=/\n\1 = /g' /tmp/wg-full.conf | grep -v '^[[:space:]]*$' > /tmp/wg-fixed.conf
		mv /tmp/wg-fixed.conf /tmp/wg-full.conf
		say "note: the secret had no line breaks; restored them"
	fi
	umask 022
	check
	if vpn_up; then export WISP_VPN=up; else export WISP_VPN=failed; fi
fi
exec node server.mjs
