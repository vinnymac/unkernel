// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// Downloads: the guest's ~/Downloads in the Browser, served by dufs (a file
// server with a file manager's page: folders, search, upload, delete, a
// folder as one zip). A file or a zip taken from it is saved to the device
// the page runs on: the preview reads it out of the guest and hands it to
// the browser as a download (public/vm-save.js). dufs is in Alpine's
// community only. It listens on the guest's loopback, which only the guest
// and the page's preview reach, so it allows everything (-A).
import type { TerminalApp } from "../types.ts";

export default {
	id: "downloads",
	title: "Downloads",
	desc: "The guest's ~/Downloads in the Browser: browse, and save files or whole folders to this device",
	// A folder with an arrow down.
	icon: { svg: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5V18a1.5 1.5 0 0 0 1.5 1.5h15A1.5 1.5 0 0 0 21 18V9a1.5 1.5 0 0 0-1.5-1.5H12L10 5H4.5A1.5 1.5 0 0 0 3 6.5z"/><path d="M12 10.5v5.5M9.5 13.5L12 16l2.5-2.5"/></g>' },
	colors: ["#0ea5e9", "#075985"],
	packages: { alpine: ["dufs"] },
	community: true,
	commands: [
		'mkdir -p "$HOME/Downloads"',
		'dufs -A -b 127.0.0.1 -p 8000 "$HOME/Downloads"',
	],
	ports: [8000],
} satisfies TerminalApp;
