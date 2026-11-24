// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// Add torrent: asks for a torrent's URL or a magnet link and hands it to the
// guest's Transmission daemon (daemon.ts), starting it if need be, then
// lists the torrents; another line adds another, an empty one lists again.
// Transmission's web interface opens in the Browser beside it. The page
// holds the screen on from the launch (a locked phone freezes the guest).
import type { TerminalApp } from "../types.ts";
import { DAEMON_SH, PACKAGES, RPC_PORT } from "./daemon.ts";

const ADD_SH = `#!/bin/sh
# Asks for torrents and adds them to the Transmission daemon.
./daemon.sh || exit 1
rpc() { transmission-remote ${RPC_PORT} "$@"; }
while :; do
	echo
	rpc -l
	echo
	printf 'A torrent URL or a magnet link (Enter: list again): '
	IFS= read -r src || break
	[ -n "$src" ] || continue
	rpc -a "$src" || echo "Not added."
	sleep 2
done
`;

export default {
	id: "addtorrent",
	title: "Add Torrent",
	desc: "Paste a torrent's URL or a magnet link; Transmission downloads it to ~/Downloads",
	// A plus in a ring.
	icon: { svg: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M8 12h8"/></g>' },
	colors: ["#f97316", "#9a3412"],
	needs: { net: true },
	files: { "daemon.sh": DAEMON_SH, "add.sh": { content: ADD_SH, mode: 0o755 } },
	packages: PACKAGES,
	community: true,
	commands: ["./add.sh"],
	ports: [RPC_PORT],
	awake: true,
} satisfies TerminalApp;
