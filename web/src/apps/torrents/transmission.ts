// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// Transmission: the BitTorrent client as a daemon in the guest, its own web
// interface shown in the Browser (add a torrent by URL, magnet link or file
// there; daemon.ts has how it is set up). The terminal follows its log;
// Ctrl-C stops that, not the daemon. The page holds the screen on from the
// launch, since a phone that locks freezes the page and with it the guest.
import type { TerminalApp } from "../types.ts";
import { DAEMON_SH, PACKAGES, RPC_PORT } from "./daemon.ts";

export default {
	id: "transmission",
	title: "Transmission",
	desc: "A BitTorrent client in the guest, its web interface in the Browser",
	// Two arrows, down and up: transfers.
	icon: { svg: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v14M3.5 13.5L8 18l4.5-4.5"/><path d="M16 20V6M11.5 10.5L16 6l4.5 4.5"/></g>' },
	colors: ["#d9242c", "#7a0d12"],
	needs: { net: true },
	files: { "daemon.sh": DAEMON_SH },
	packages: PACKAGES,
	community: true,
	commands: [
		"./daemon.sh",
		'echo "Transmission runs; its web interface opens in the Browser. Files: the Downloads app."',
		'tail -n 20 -f "$HOME/.config/transmission-daemon/daemon.log"',
	],
	ports: [RPC_PORT],
	awake: true,
} satisfies TerminalApp;
