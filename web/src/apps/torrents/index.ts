// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// The launcher's Torrents folder: Transmission in the guest, a prompt that
// adds a torrent to it, and the downloaded files in the Browser.
// One file per app in this folder, listed below in the order it shows them.
import { defineGroup } from "../types.ts";
import addtorrent from "./addtorrent.ts";
import downloads from "./downloads.ts";
import transmission from "./transmission.ts";

export default defineGroup({
	id: "torrents", title: "Torrents", desc: "A BitTorrent client in the guest and the files it downloads",
	// An arrow down onto a tray.
	icon: { svg: '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v10M7.5 10L12 14.5 16.5 10"/><path d="M4.5 16.5v2A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-2"/></g>' },
	colors: ["#ef4444", "#7f1d1d"],
}, [addtorrent, transmission, downloads]);
