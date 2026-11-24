// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// The launcher's app registry: what an app file (apps/<group>/<id>.ts)
// default-exports, and what a group (apps/<group>/index.ts) declares.
//
// - An app is one file. Its `kind` says how it runs: "terminal" (the
//   default) in a new terminal, as launcher.ts runs it (files written into
//   the guest, packages installed, commands run, the preview opened on its
//   ports), a tab of the Terminal window or, with `terminal: "window"`, a
//   Terminal window of its own; "page" is one of the page's own windows
//   (Terminal, Browser, Settings, System), which the app opens itself.
// - A group is a folder: its id is the folder's name, its index.ts declares
//   it with defineGroup() and lists its apps in order, and that is where an
//   app's `group` comes from. An `inline` group's apps sit at the launcher's
//   top level instead of in a folder.
// - apps/index.ts lists the groups in order (GROUPS) and all apps (APPS).
// - AppMeta: what the chrome (the Dock, the top bar, a window's title bar)
//   shows of anything that is a window or a Dock tile: its name, its icon and
//   its key. A window gets one from what opens it (wm.ts WindowSpec.meta); a
//   page app is one itself (the same declaration feeds its launcher entry and
//   its window); a terminal app's is made from its entry (appwindows.ts
//   appMeta()), and is also a Wayland window's whose app id is the app's
//   (waylandIds; wayland/host.ts).
import type { ReactNode } from "react";
import type { FileSpec } from "../download.ts";
import type { CommandId } from "../keys.ts";

export interface AppFile {
	content: string;
	/** Octal mode as a number, e.g. 0o755. Default 0o644. */
	mode?: number;
}

/** An app's files, by path relative to its dir, to the home directory (starting with ~/), or absolute. */
export type AppFiles = Record<string, string | AppFile>;

/** A tile's pictogram: SVG elements (paths, shapes) as static markup from this repository. */
export interface AppIcon {
	svg: string;
	viewBox?: string;
}

/** One of the chrome's stroke icons (components/icons.tsx), drawn `size` px in currentColor. */
export type ChromeIcon = (p: { size?: number }) => ReactNode;

/** An image by URL, drawn in an <img> (never inlined): a guest app's own icon as a blob: URL (wayland/icons.ts). */
export interface ImageIcon {
	src: string;
}

/**
 * What the chrome shows of a window or a Dock tile (see the top of this
 * file). A window kind declares it once, where it opens its window
 * (termtabs.ts TERMINAL, sysapps.ts SETTINGS and SYSTEM, preview.ts BROWSER,
 * display.ts DISPLAY; a Wayland window's carries its app's title and icon,
 * or is its launcher app's, wayland/host.ts); a window's may change while it
 * is open (a Terminal window whose only tab is a terminal app's is that app:
 * termtabs.ts).
 */
export interface AppMeta {
	/** Its app's id: a launcher app's (APPS: its Dock pin, its Keep in Dock) or a window kind's own (display, wayland). */
	id: string;
	/** Its name: the top bar's current app, a pinned tile's tooltip, a tile menu's header; a window opened without a title takes it. */
	title: string;
	/** Its icon on its Dock tile and in its window's title bar: a stroke icon, else an app's glyph (as AppBase.icon), or an image (a Wayland app's icon from the guest); none: the title's first letter. */
	glyph?: ChromeIcon | string | AppIcon | ImageIcon;
	/** Its tile's colours, as a launcher app's (AppBase.colors): its Dock tile's face; none: the Dock's glass. */
	colors?: [string, string];
	/** The command that opens or shows it (keys.ts): its Dock tile shows the key while the prefix is armed, and in its tooltip. */
	cmd?: CommandId;
}

/** A file the page fetches and pushes into the guest before the app runs (download.ts). */
export interface AppDownload extends FileSpec {
	/** Where it goes in the guest: relative to the app's dir, or absolute. */
	path: string;
	/** A shell test run in dir: when it succeeds the file is not needed, and nothing is fetched. */
	unless?: string;
}

/** The distro images an app can name packages for. */
export type Distro = "alpine" | "debian";

interface AppBase {
	id: string;
	title: string;
	/** Left out of the launcher (an app that is not ready yet); its file stays. */
	hidden?: boolean;
	/** One line: the tile's tooltip, and what search matches besides the title. */
	desc: string;
	/**
	 * The tile's glyph: a character or an emoji (default: the title's first
	 * letter), or a pictogram as inline SVG markup in `viewBox` (default
	 * "0 0 24 24"), filled white (currentColor) unless the markup sets its own.
	 */
	icon?: string | AppIcon;
	/** The tile's gradient, top left to bottom right (CSS colours). */
	colors?: [string, string];
	/** wayland: the Wayland desktop (wayland.ts: a kernel with vsock and kwshm); vk: guest Vulkan (the Vulkan option). */
	needs?: { display?: boolean; net?: boolean; sound?: boolean; wayland?: boolean; vk?: boolean };
}

/** An app run in a new terminal tab named after it (launcher.ts). */
export interface TerminalApp extends AppBase {
	kind?: "terminal";
	/**
	 * Where its terminal opens: "tab" (the default), a tab of the Terminal
	 * window that last had the focus; "window", a Terminal window of its own,
	 * for an app whose terminal is the app itself (a REPL, an agent, a
	 * full-screen program).
	 */
	terminal?: "tab" | "window";
	/** The working directory in the guest. Default ~/.apps/<id>. */
	dir?: string;
	/**
	 * Files to write, by path relative to dir, to ~ (~/...) or absolute
	 * (written with sudo when the user cannot write it), or a function
	 * that loads them when the app launches (a dynamic import), which keeps
	 * their text out of the page's main chunk.
	 */
	files?: AppFiles | (() => Promise<AppFiles>);
	/** Files fetched by the page and pushed into the guest before run.sh starts. */
	downloads?: AppDownload[];
	/**
	 * Packages to install first (those not installed yet), per distro. With
	 * it, the app runs only on the distros it names (an empty list: nothing
	 * to install there).
	 */
	packages?: Partial<Record<Distro, string[]>>;
	/**
	 * Alpine: some packages are in community: enable it first (/etc/kw-apk-enable).
	 * The image starts apk with main only, since every apk command parses
	 * all enabled indexes and community's makes that ~2 s slower.
	 */
	community?: boolean;
	/**
	 * Shell commands run in order in dir (run.sh, set -e); the last may run in
	 * the foreground. A step that needs root is written `$SUDO cmd` (sudo.ts),
	 * and printed as `sudo cmd`.
	 */
	commands: string[];
	/** Ports the app serves http on: the preview opens on the first once it answers. */
	ports?: number[];
	/** Its work goes on unattended (a download): the page holds the screen on from its launch (awake.ts). */
	awake?: boolean;
	/**
	 * The Wayland app ids (xdg_toplevel.set_app_id) its windows set, when
	 * they are not its id (nor, reverse-DNS, end in it: org.gnome.Tali):
	 * such a window stands for this app (appwindows.ts waylandApp()).
	 */
	waylandIds?: string[];
}

/**
 * One of the page's own windows, which the app opens (or shows, when it is
 * open) itself. It is its window's AppMeta too: its id, title, glyph (the
 * chrome's icon; `icon` is the launcher's pictogram) and cmd come from the
 * window kind's declaration, spread in.
 */
export interface PageApp extends AppBase, AppMeta {
	kind: "page";
	/** The window it lives in (wm.ts id): the tile's running dot while it is open. */
	win?: string;
	open(): void;
	/** Why it cannot open now, or null. */
	unavailable?(): string | null;
}

/** What an app file default-exports. */
export type AppDef = TerminalApp | PageApp;
/** An app in the registry: its definition, and the group it is listed in. */
export type App = AppDef & { group: string };

export const isPageApp = (a: AppDef): a is PageApp => a.kind === "page";

export interface GroupDef {
	/** The folder's name. */
	id: string;
	title: string;
	/** One line, for the folder's tooltip. */
	desc?: string;
	/** The group's own icon, by the open folder's title: a glyph or pictogram (as an app's icon; default the title's first letter) on its gradient. */
	icon?: string | AppIcon;
	colors?: [string, string];
	/** Its apps sit at the launcher's top level, not in a folder. */
	inline?: boolean;
}
export interface Group extends GroupDef {
	apps: App[];
}

/** A group (apps/<id>/index.ts) and its apps, in the order the launcher lists them. An app's getters stay getters (chromium.ts commands). */
export function defineGroup(g: GroupDef, apps: AppDef[]): Group {
	return { ...g, apps: apps.map((a) => Object.defineProperties({ group: g.id }, Object.getOwnPropertyDescriptors(a)) as App) };
}
