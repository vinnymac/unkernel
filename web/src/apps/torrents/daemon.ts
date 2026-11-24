// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// What the Torrents apps share: the Transmission daemon and how it is started.
//
// One transmission-daemon per guest, the user's own (not the distro's
// service), started by whichever app runs first and left running: config in
// ~/.config/transmission-daemon, files to ~/Downloads, RPC and the web
// interface on 127.0.0.1:9091 without a password (only the guest and the
// page's preview reach the guest's loopback). The guest is behind the page's
// user-mode network, outbound only, so no port mapping; a finished torrent
// stops (seed ratio 0) instead of seeding to nobody. DHT and uTP need UDP,
// which the page relays where its Wisp server does (js.md, Network).
import type { AppFile } from "../types.ts";

export const RPC_PORT = 9091;

/** daemon.sh: start the daemon unless one answers; prints nothing when it runs already. */
export const DAEMON_SH: AppFile = {
	mode: 0o755,
	content: `#!/bin/sh
# Starts the user's transmission-daemon unless it answers already.
conf=$HOME/.config/transmission-daemon
mkdir -p "$conf" "$HOME/Downloads"
if ! transmission-remote ${RPC_PORT} -l >/dev/null 2>&1; then
	echo "Starting Transmission (files go to ~/Downloads)"
	transmission-daemon -g "$conf" -w "$HOME/Downloads" --no-incomplete-dir \\
		-p ${RPC_PORT} -a 127.0.0.1 -T -M --dht --utp -gsr 0 \\
		-e "$conf/daemon.log" --log-level=info
	i=0
	until transmission-remote ${RPC_PORT} -l >/dev/null 2>&1; do
		i=$((i + 1))
		[ $i -le 30 ] || { echo "Transmission did not start; see $conf/daemon.log" >&2; exit 1; }
		sleep 1
	done
fi
`,
};

/** Both distros package the daemon with its web interface; transmission-remote is its own package on Alpine. */
export const PACKAGES = {
	alpine: ["transmission-daemon", "transmission-remote"],
	debian: ["transmission-daemon", "transmission-cli"],
};
