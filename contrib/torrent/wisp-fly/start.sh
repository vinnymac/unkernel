#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Vincent Taverna
# Wisp server for unkernel on a Fly machine. With the secret WG_CONF (a WireGuard
# client config, wg-quick format) every connection the server makes for the guest,
# TCP and UDP, leaves through that tunnel; without it they leave from Fly directly.
set -e
cd /app
[ -d node_modules/@mercuryworkshop/wisp-js ] || npm i --no-audit --no-fund @mercuryworkshop/wisp-js@0.5.3
if [ -n "$WG_CONF" ]; then
	apk add --no-cache wireguard-tools-wg iproute2 iptables >/dev/null
	umask 077
	printf '%s\n' "$WG_CONF" | tr -d '\r' > /tmp/wg-full.conf
	# wg(8) takes only its own keys; the wg-quick ones are applied by hand below.
	grep -viE '^[[:space:]]*(Address|DNS|MTU|Table|PreUp|PostUp|PreDown|PostDown|SaveConfig)[[:space:]]*=' /tmp/wg-full.conf > /tmp/wg0.conf
	val() { sed -nE "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//Ip" /tmp/wg-full.conf | tr ',' ' '; }
	ip link add wg0 type wireguard 2>/dev/null || { apk add --no-cache wireguard-go >/dev/null; wireguard-go wg0; }
	wg setconf wg0 /tmp/wg0.conf
	for a in $(val Address); do case $a in *:*) ;; *) ip addr add "$a" dev wg0 ;; esac; done   # IPv4 only
	mtu=$(val MTU); ip link set wg0 mtu "${mtu:-1380}" up
	# Everything goes to the tunnel except the tunnel's own packets (fwmark) and
	# Fly's side of eth0 (its proxy and private network, 172.16.0.0/12).
	wg set wg0 fwmark 51820
	ip route add default dev wg0 table 51820
	ip rule add priority 80 to 172.16.0.0/12 lookup main
	ip rule add priority 85 lookup main suppress_prefixlength 0
	ip rule add priority 90 not fwmark 51820 lookup 51820
	# Kill switch: nothing but the tunnel itself and Fly's side leaves eth0, and no public IPv6 at all.
	iptables -A OUTPUT -o eth0 -m mark --mark 51820 -j ACCEPT
	iptables -A OUTPUT -o eth0 -d 172.16.0.0/12 -j ACCEPT
	iptables -A OUTPUT -o eth0 -j REJECT
	ip6tables -A OUTPUT -d fdaa::/16 -j ACCEPT 2>/dev/null && ip6tables -A OUTPUT -d fe80::/10 -j ACCEPT && ip6tables -A OUTPUT -d ::1 -j ACCEPT \
		&& ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT && ip6tables -A OUTPUT -j REJECT || echo "no ip6tables: IPv6 is not blocked"
	dns=$(val DNS); : > /etc/resolv.conf
	for d in ${dns:-1.1.1.1 9.9.9.9}; do case $d in *:*|*[a-z]*) ;; *) echo "nameserver $d" >> /etc/resolv.conf ;; esac; done
	export WISP_VPN=1
	echo "wireguard up: $(wg show wg0 endpoints | cut -f2)"
fi
exec node server.mjs
