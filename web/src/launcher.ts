// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// The launcher: apps that show what unkernel runs, opened from the Dock's
// first tile (components/Launcher.tsx). Each app is a file in
// apps/<group>/, its group's folder (apps/index.ts, apps/types.ts). A page
// app (kind "page": Terminal, Browser, Settings, System) opens one of the
// page's windows itself. A terminal app (the default kind) is what this
// module runs: the page ships no assets for them, so it is text only: files
// written into the guest, packages installed with apk, commands run in a new
// terminal window, and the preview opened on the ports it serves.
//
// launch(app), for a terminal app:
// 1. checks what it needs first, in one vm.exec() (planApp(): PLAN_SH):
//    whether this boot's distro lacks any of its packages (installedTest(),
//    the same test install.sh starts with), and which of its downloads are
//    missing in the guest (unless their `unless` test passes in its dir).
//    Nothing missing: the app starts at once (2, then 3). Else its installer
//    (installer.ts, components/Installer.tsx: a small window of its own with
//    the app's icon, a progress bar, the current step and the log) does 2
//    and the rest out of sight, then closes and the app starts (3); a
//    failure stays there, with the log and Retry;
// 2. writes the app's files (loaded first when the app gives a loader)
//    under its directory (~/.apps/<id> unless it sets dir; an old
//    ~/demos/<id> is moved there first) through vm.exec(), one exec per file
//    (waiting for the guest's kwtty while it boots), with run.sh and, when
//    it has packages, install.sh. vm.exec() and the terminal run as the
//    distro's user (sudo.ts): the directory is made the user's (with sudo
//    when it is outside the user's reach, nginx's /srv/nginx), a file the
//    user cannot write (an absolute path under /etc) is written with sudo;
//    in the installer then:
//    - the downloads (download.ts: plain http over Wisp, checked against
//      their SHA-256, kept in the browser's cache), each pushed into the
//      guest; a failure is logged, not fatal: the app's script must check
//      the file and fetch it itself when missing;
//    - install.sh, run on pipes (vm.spawn(), no terminal) in a login shell,
//      its output the installer's log and progress (installer.ts
//      packageParser(); KW_STATUS=1 adds apt's status lines): unless the
//      packages are all installed (then it prints nothing), Alpine:
//      community enabled if the app asks, then `apk add`; Debian:
//      `apt-get install`, once more after `apt-get update` when the image's
//      baked package lists name a version the mirror no longer has. The
//      package manager runs with sudo ($SUDO, SUDO_SH; as root on the base
//      shell without it), each step printed as `sudo cmd`;
//    run.sh runs ./install.sh first too (a no-op once installed, so the
//    app's terminal shows only the app; it installs again when the user
//    removed something), then the commands, each printed before it runs,
//    under set -e, the steps written `$SUDO cmd` with sudo;
// 3. opens a terminal named after the app (wterms.ts): a tab of the
//    Terminal window that last had the focus, or, for an app whose terminal
//    is the app itself (`terminal: "window"`: a REPL, an agent, a full-screen
//    program), a Terminal window of its own (the Dock shows it with the
//    app's icon and title while it is that window's only tab); running
//    WRAP_SH in place of the login shell: it runs `cd <dir> && ./run.sh`
//    and then execs the login shell, so the window stays to edit run.sh
//    and run it again. Ctrl-C stops run.sh, not the wrapper. (Typing the
//    command into a fresh shell lost the start of the line: the login reads
//    or flushes input typed ahead of its prompt.) A Wayland app's terminal
//    (`needs.wayland`) is its log: its tab opens selected, as any app's,
//    and shows until the app's window maps and takes the focus (with
//    `terminal: "window"` its own Terminal window is minimized at once
//    instead); it closes when run.sh ends with status 0 (WRAP_SH's "close")
//    and stays after a failure;
// 4. with ports, waits until the guest answers http on each, opens the
//    preview on the first (preview.ts) and toasts the others.
// An app runs once at a time: launching one whose window is open (a window
// named after it, even after run.sh ended) shows that window instead, and
// one being installed shows its installer.
// An app names its packages per distro (`packages: { alpine, debian }`), since
// the names differ; its scripts handle what else differs (paths, wget on
// Alpine and curl on Debian, apk's or dpkg's database). Alpine's come from
// main; an app with `community` enables community first (lazy in the image,
// .agents/kernel/guest.md), once per guest.
// An app whose `needs` the page cannot meet (?display=0, ?net=0, ?sound=0, a
// kernel without the Wayland desktop) is listed
// but disabled, with why; so is one whose `packages` leave out this boot's
// distro (?distro=).
import { createElement } from "react";
import { keepAwake } from "./awake.ts";
import { isPageApp, type AppDef, type AppDownload, type AppFiles, type Distro, type TerminalApp } from "./apps/types.ts";
import { Installer } from "./components/Installer.tsx";
import { getFile, pushFile } from "./download.ts";
import { fmtMiB } from "./format.ts";
import { cleanLine, InstallCancelled, packageParser, runInstall, showInstaller, type InstallCtl } from "./installer.ts";
import { keyFor, PREFIX } from "./keys.ts";
import { KW } from "./kw.ts";
import { isHeld, isRunning, ui$ } from "./store.ts";
import { selectTerminal } from "./terminals.ts";
import type { KernelHandle } from "./sdk.ts";
import { SUDO_SH } from "./sudo.ts";
import { termWindow } from "./termtabs.ts";
import { wm } from "./wm.ts";

const DISTROS: Distro[] = ["alpine", "debian"];
const isDistro = (s: string): s is Distro => (DISTROS as string[]).includes(s);

/** What had the keyboard focus when the launcher opened (null: nothing, the page's body). */
let before: HTMLElement | null = null;

/**
 * Show or hide the launcher overlay (components/Launcher.tsx); it opens only
 * while the system runs. Closed, it gives the focus back to what had it (the
 * focused window's terminal, field or app, a Dock tile activated by key), or,
 * when that is gone (closed, a hidden tab, the menu item that opened it), to
 * the current terminal; with nothing focused before, to the terminal only
 * while a Terminal window is the focused window (wm.ts). Not on touch
 * devices, where a focused field would raise the on-screen keyboard.
 */
export function setLauncher(open: boolean): void {
	const $ = ui$();
	if ($.get().launcher === open) return;
	// Its apps need a running system (store.ts isRunning; the Dock dims its tile until then).
	if (open && !isRunning($.get())) { KW.ui?.toast("Apps open once the system is running"); return; }
	if (open) {
		const a = document.activeElement;
		before = a instanceof HTMLElement && a !== document.body ? a : null;
	}
	$.set({ launcher: open });
	if (open || KW.config.coarse) return;
	const back = before;
	before = null;
	if (back?.isConnected && !back.closest("#launcher, [inert]")) back.focus({ preventScroll: true });
	else if (back || termWindow(wm.focused())) KW.term?.focus();
}
export const toggleLauncher = (): void => setLauncher(!ui$().get().launcher);

/** The distros a terminal app runs on, or null for any. */
export function appDistros(d: TerminalApp): Distro[] | null {
	return d.packages ? DISTROS.filter((x) => d.packages![x]) : null;
}

/** The packages a terminal app installs on this boot's distro. */
export function appPackages(d: TerminalApp): string[] {
	const g = KW.config.guest;
	return isDistro(g) ? d.packages?.[g] ?? [] : [];
}

const DISTRO_NAMES: Record<Distro, string> = { alpine: "Alpine", debian: "Debian" };

/** Why the app cannot run on this page, or null. */
export function unavailable(d: AppDef): string | null {
	if (isPageApp(d)) return d.unavailable?.() ?? null;
	if (d.needs?.display && !KW.config.display) return "needs the display (off with ?display=0)";
	if (d.needs?.net && !KW.config.net) return "needs the network (off with ?net=0)";
	if (d.needs?.sound && !KW.config.sound) return "needs sound (off with ?sound=0)";
	if (d.needs?.vk && !KW.config.vk) return `needs guest Vulkan (${KW.config.vkWhy ?? "off in Settings, Display and sound"})`;
	if (d.needs?.wayland && KW.vm && !ui$().get().wayland.available) return "needs the Wayland desktop: this boot has no kwshm (?shm=0, or a session resumed from before the desktop)";
	const on = appDistros(d);
	const g = KW.config.guest;
	if (on && !(isDistro(g) && on.includes(g)))
		return `runs on ${on.map((x) => DISTRO_NAMES[x]).join(" or ")}; this boot runs ${g === "none" ? "no distro" : isDistro(g) ? DISTRO_NAMES[g] : g} (Options, Distro)`;
	return null;
}

/** Single-quoted for sh. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// Makes the app's directory $1 (relative to ~, or absolute) and gives it to
// the user: one outside the user's reach (/srv/nginx), or one that is root's
// (made by a launcher of the days when sessions ran as root), is made and
// handed over with sudo, so the user can edit its files. $2, when set, is
// where the directory used to be (relative to ~): moved to $1 when there and
// $1 is not, with its parent removed once empty.
const DIR_SH = `cd ~
[ -n "$2" ] && [ -d "$2" ] && [ ! -e "$1" ] && mkdir -p "\${1%/*}" && mv "$2" "$1" 2>/dev/null && rmdir "\${2%/*}" 2>/dev/null
mkdir -p "$1" 2>/dev/null && [ "$(stat -c %u "$1")" = "$(id -u)" ] && exit 0
${SUDO_SH}
S=\${SUDO:+$SUDO -n}
$S mkdir -p "$1" && $S chown -R "$(id -u):$(id -g)" "$1"`;

// Writes stdin to $1 (relative to ~, or absolute) with mode $2, making its
// directory; as root (sudo) when the user cannot write it there (a file
// under /etc), so such a file stays root's.
const WRITE_SH = `set -e
cd ~
case "$1" in */*) d=\${1%/*};; *) d=.;; esac
S=
if ! { mkdir -p "$d" 2>/dev/null && [ -w "$d" ] && { [ ! -e "$1" ] || [ -w "$1" ]; }; }; then
	${SUDO_SH}
	S=\${SUDO:+$SUDO -n}
fi
$S mkdir -p "$d"
$S tee "$1" >/dev/null
$S chmod "$2" "$1"`;

/** A path in an app: relative to its dir, else to ~ (~/...), else absolute. */
const appPath = (dir: string, rel: string) => (rel.startsWith("/") || rel.startsWith("~/") ? rel : `${dir}/${rel}`);
/** As $1 of a script that runs `cd ~` first: no ~/. */
const fromHome = (path: string) => path.replace(/^~\//, "");

async function writeFiles(vm: KernelHandle, dir: string, files: AppFiles, oldDir = "", onFile?: (done: number, total: number) => void) {
	// sh expands the ~ in dir; paths are passed as $1 so they are not split.
	const d = await vm.exec("/bin/sh", ["-c", DIR_SH, "sh", dir === "~" ? "." : fromHome(dir), oldDir]);
	if (d.exitCode !== 0) throw new Error(`making ${dir} failed: ${(d.stderr || d.stdout).trim() || `exit ${d.exitCode}`}`);
	const all = Object.entries(files);
	onFile?.(0, all.length);
	for (const [i, [rel, f]] of all.entries()) {
		const { content, mode = 0o644 } = typeof f === "string" ? { content: f } : f;
		const path = appPath(dir, rel);
		const r = await vm.exec("/bin/sh", ["-c", WRITE_SH, "sh", fromHome(path), mode.toString(8)], { input: content });
		if (r.exitCode !== 0) throw new Error(`writing ${path} failed: ${(r.stderr || r.stdout).trim() || `exit ${r.exitCode}`}`);
		onFile?.(i + 1, all.length);
	}
}

/**
 * A step as run.sh prints it after its dim "$ ", as one sh word: each
 * `$SUDO ` prints as "sudo " where run.sh uses sudo, else as nothing.
 */
function shownWord(shown: string): string {
	const parts = shown.split("$SUDO ");
	return parts.map((p) => (p || parts.length === 1 ? q(p) : "")).join('"${SUDO:+sudo }"');
}

/** A step as the scripts print it (dim, after a $) before they run cmd. */
const step = (shown: string, cmd = shown) => `printf '\\033[90m$ %s\\033[0m\\n' ${shownWord(shown)}\n${cmd}\n`;

/**
 * A shell test that succeeds when the app's packages for this boot's distro
 * are all installed (as the user: it only reads the package database), or ""
 * when it names none: what planApp() asks and what install.sh starts with.
 */
function installedTest(d: TerminalApp): string {
	const pkgs = appPackages(d);
	if (!pkgs.length) return "";
	const pk = pkgs.map(q).join(" ");
	if (KW.config.guest === "alpine") return `apk info -e ${pk} >/dev/null 2>&1`;
	return `[ "$(dpkg-query -W -f='\${db:Status-Status}\\n' ${pk} 2>/dev/null | grep -cx installed)" = ${pkgs.length} ]`;
}

/**
 * install.sh for this boot's distro, or null when the app names no packages
 * for it: nothing (and no output) when they are all installed, else the
 * install, each step printed (dim, after a $) before it runs. With KW_STATUS
 * set (the installer, launcher.ts) apt also writes its status lines
 * (APT::Status-Fd) to stdout, which installer.ts packageParser() reads.
 */
export function installScript(d: TerminalApp): string | null {
	const test = installedTest(d);
	if (!test) return null;
	const pkgs = appPackages(d);
	const pk = pkgs.map(q).join(" ");
	let install: string;
	if (KW.config.guest === "alpine") {
		install = (d.community ? step("$SUDO /etc/kw-apk-enable   # community") : "") + step(`$SUDO apk add ${pkgs.join(" ")}`, `$SUDO apk add ${pk}`);
	} else {
		// stdin from /dev/null: dpkg would eat what was typed ahead. The image's
		// package lists are baked in and age: when a version is gone from the
		// mirror, the install fails, and runs again after apt-get update. An
		// install stopped halfway (a reload, a closed window, the machine
		// stopped) leaves dpkg interrupted, and apt refuses everything until
		// `dpkg --configure -a`: this runs that first when dpkg's journal is not
		// empty (|| true: it fails while another app's apt holds the lock), and,
		// when the install still fails, again with `apt-get install -f` (which
		// mends half-installed dependencies) before the last try. The lock
		// timeout makes two apps installed at once take turns rather than fail.
		// Status-Fd=1: sudo closes the descriptors from 3 up.
		const get = `$SUDO apt-get install -y -q -o DPkg::Lock::Timeout=600 \${KW_STATUS:+-o APT::Status-Fd=1} --no-install-recommends ${pk} </dev/null`;
		install = `[ -z "$(ls -A /var/lib/dpkg/updates 2>/dev/null)" ] || {\n` +
			step("$SUDO dpkg --configure -a   # finish an interrupted install", "$SUDO dpkg --configure -a </dev/null || true") +
			`}\n` +
			step(`$SUDO apt-get install ${pkgs.join(" ")}`, `${get} ||\n` +
				`{ $SUDO apt-get update -q </dev/null && ${get}; } ||\n` +
				`{ $SUDO dpkg --configure -a </dev/null && $SUDO apt-get install -f -y -q -o DPkg::Lock::Timeout=600 </dev/null && ${get}; }`);
	}
	return `#!/bin/sh
# What the ${d.title} app needs on ${KW.config.guest}, written by the unkernel launcher:
# its installer runs this, and so does run.sh (once all is installed it does nothing).
set -e
# Root for the steps written $SUDO: sudo, unless this runs as root already.
${SUDO_SH}
${test} && exit 0
${install}`;
}

/** run.sh for this boot's distro: install.sh when there is one, then the commands, each printed (dim, after a $) before it runs. */
export function runScript(d: TerminalApp): string {
	return `#!/bin/sh
# The ${d.title} demo, written by the unkernel launcher for ${KW.config.guest}. Edit it and run it again.
set -e
# Root for the steps written $SUDO: sudo, unless this runs as root already.
${SUDO_SH}
cd "$(dirname "$0")"
${installedTest(d) ? "./install.sh\n" : ""}${d.commands.map((c) => step(c)).join("")}`;
}

/** What an app lacks before it can run (planApp()). */
interface Plan {
	/** Some of its packages are not installed. */
	packages: boolean;
	/** The downloads missing in the guest. */
	downloads: AppDownload[];
}
const needsWork = (p: Plan) => p.packages || p.downloads.length > 0;

// need DIR PATH SIZE UNLESS: succeeds when PATH (relative to ~, or absolute)
// is missing or not SIZE bytes long and the test UNLESS fails, run in DIR
// (relative to ~; in ~ while DIR does not exist yet).
const NEED_SH = `need() {
	( cd ~ && { cd "$1" 2>/dev/null || :; } && [ -n "$4" ] && eval "$4" ) >/dev/null 2>&1 && return 1
	cd ~ && [ -f "$2" ] && [ "$(stat -c %s "$2")" = "$3" ] && return 1
	return 0
}`;

/** What the app lacks in the guest, in one exec (step 1 at the top of this file). */
async function planApp(vm: KernelHandle, d: TerminalApp, dir: string, signal?: AbortSignal): Promise<Plan> {
	const test = installedTest(d);
	const dls = d.downloads ?? [];
	if (!test && !dls.length) return { packages: false, downloads: [] };
	const home = dir.replace(/^~\/?/, "") || ".";
	const script = [
		test ? `${test} || echo packages` : "",
		dls.length ? NEED_SH : "",
		...dls.map((f, i) => `need ${q(home)} ${q(fromHome(appPath(dir, f.path)))} ${f.size ?? -1} ${q(f.unless ?? "")} && echo need ${i}`),
		"true",
	].filter(Boolean).join("\n");
	const r = await vm.exec("/bin/sh", ["-c", script], { signal });
	if (r.exitCode !== 0) throw new Error(`checking what it needs failed: ${(r.stderr || r.stdout).trim() || `exit ${r.exitCode}`}`);
	const lines = r.stdout.split("\n").map((l) => l.trim());
	return {
		packages: lines.includes("packages"),
		downloads: dls.filter((_, i) => lines.includes(`need ${i}`)),
	};
}

/** The app's files, run.sh and install.sh. */
async function appFiles(d: TerminalApp): Promise<AppFiles> {
	const files = typeof d.files === "function" ? await d.files() : d.files;
	const install = installScript(d);
	return { ...files, ...(install ? { "install.sh": { content: install, mode: 0o755 } } : {}), "run.sh": { content: runScript(d), mode: 0o755 } };
}

/** A download's file name, for the log. */
const fileName = (f: AppDownload) => f.url.replace(/[?#].*$/, "").split("/").pop() || f.url;

// Runs install.sh in DIR ($1, relative to ~, or absolute) for the installer, stderr with stdout.
const INSTALL_SH = `cd && cd "$1" && exec ./install.sh 2>&1`;

/**
 * Read a stream of guest output as lines (UTF-8), each to `line`; the last
 * one even without its newline.
 */
async function eachLine(stream: ReadableStream<Uint8Array>, line: (s: string) => void): Promise<void> {
	const dec = new TextDecoder();
	let buf = "";
	const reader = stream.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += dec.decode(value, { stream: true });
			let i: number;
			while ((i = buf.indexOf("\n")) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
		}
		buf += dec.decode();
		if (buf) line(buf);
	} catch { /* the session went: ended says how */ }
}

/** The weights of the installer's stages (installer.ts: any scale). */
const W_FILES = 2, W_SHARE = 98;
/** Of a download's weight: fetching it (the rest: pushing it into the guest). */
const FETCH_SHARE = 0.8;

/**
 * The installer's work (step 2 at the top of this file): the files, the
 * downloads, the packages, reporting to ctl. `first`: the plan launch()
 * made (a retry makes its own).
 */
async function prepare(vm: KernelHandle, d: TerminalApp, dir: string, ctl: InstallCtl, first?: Plan): Promise<void> {
	const ui = KW.ui!;
	const signal = ctl.signal;
	ctl.cancelable(true);
	ctl.step("Preparing…");
	const plan = first ?? await planApp(vm, d, dir, signal);
	const dls = plan.downloads;
	const sizes = dls.map((f) => f.size ?? 8 << 20);
	const sum = sizes.reduce((a, b) => a + b, 0) || 1;
	const dlShare = dls.length ? (plan.packages ? 0.4 : 1) * W_SHARE : 0;
	const pkgShare = plan.packages ? W_SHARE - dlShare : 0;
	ctl.plan([
		["files", W_FILES],
		...dls.flatMap((_, i): [string, number][] => [[`get${i}`, dlShare * (sizes[i]! / sum) * FETCH_SHARE], [`push${i}`, dlShare * (sizes[i]! / sum) * (1 - FETCH_SHARE)]]),
		["packages", pkgShare],
	]);

	// The default dir was ~/demos/<id> before: an existing one moves (DIR_SH).
	await writeFiles(vm, dir, await appFiles(d), d.dir ? "" : `demos/${d.id}`, (n, total) => ctl.stage("files", total ? n / total : 1));
	signal.throwIfAborted();

	for (const [i, f] of dls.entries()) {
		const path = appPath(dir, f.path), name = fileName(f);
		ctl.stage(`get${i}`, 0);
		ctl.step("Downloading…");
		ctl.log(`[installer] fetching ${f.url}`);
		try {
			const t0 = performance.now();
			const got = await getFile(f, {
				servers: KW.config.wisp,
				signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]),
				onProgress: (n, total) => {
					if (total) ctl.stage(`get${i}`, n / total);
					ctl.step(`Downloading ${fmtMiB(n).replace(/ MiB$/, "")}${total ? ` of ${fmtMiB(total)}` : " MiB"}…`);
				},
			});
			const t1 = performance.now();
			ctl.stage(`push${i}`, 0);
			ctl.step("Copying into the system…");
			await pushFile(vm, path, got.bytes, signal);
			ctl.stage(`push${i}`, 1);
			const msg = `pushed ${name} (${fmtMiB(got.bytes.length)}, ${got.source === "cache" ? "from the browser cache" : "downloaded"}` +
				`${got.checked ? "" : ", SHA-256 not checked: no secure context"}) to ${path}: ` +
				`${((t1 - t0) / 1000).toFixed(1)} s to get, ${((performance.now() - t1) / 1000).toFixed(1)} s to push`;
			ctl.log(`[installer] ${msg}`);
			ui.log(`[app] ${d.id}: ${msg}`, "h");
		} catch (e) {
			if (signal.aborted) throw new InstallCancelled();
			const msg = (e as Error)?.message ?? String(e);
			ctl.log(`[installer] ${name}: ${msg}; the app fetches it itself`);
			ui.log(`[app] ${d.id}: ${name}: ${msg}; the guest fetches it instead`, "e");
		}
	}

	if (!plan.packages) return;
	ctl.stage("packages", null);
	ctl.step("Installing packages…");
	const parse = packageParser(KW.config.guest as Distro);
	let lastError = "";
	const onLine = (raw: string) => {
		const line = cleanLine(raw);
		const r = parse(line);
		if (r.unsafe) ctl.cancelable(false);
		if (r.done !== undefined) ctl.stage("packages", r.done);
		if (r.step) ctl.step(r.step);
		if (/^(E: |ERROR: |error: |dpkg: error)/.test(line)) lastError = line.replace(/^(E|ERROR|error): /, "");
		if (!r.hide) ctl.log(raw);
	};
	// A login shell, as the terminal's: PATH and the apk hooks.
	const p = await vm.spawn("/bin/sh", ["-lc", INSTALL_SH, "sh", fromHome(dir) === "~" ? "." : fromHome(dir)], { pty: false, env: { KW_STATUS: "1" }, signal });
	ctl.onCancel(() => { void p.close().catch(() => {}); });
	try {
		void p.stdin.close().catch(() => {});
		await Promise.all([eachLine(p.stdout, onLine), eachLine(p.stderr, onLine)]);
		const end = await p.ended;
		if (signal.aborted) throw new InstallCancelled();
		if (end.type === "exit" && end.code === 0) { ctl.stage("packages", 1); return; }
		if (end.type === "lost" || end.type === "closed") throw new Error("The install stopped with the system");
		throw new Error(lastError || (end.type === "exit" ? `Installing packages failed (exit ${end.code})` : `Installing packages was stopped (signal ${end.signal})`));
	} finally {
		ctl.onCancel(null);
	}
}

// Runs in an app's window as `sh -lc WRAP_SH sh DIR SHOWN [close]`: run.sh in DIR
// (relative to ~, or absolute; SHOWN is how to print it), then the login
// shell, or with "close" nothing more when run.sh ended with status 0 (the
// terminal goes).
// The INT trap (a handler, reset in children) keeps this shell alive
// when Ctrl-C stops run.sh.
const WRAP_SH = `trap : INT
printf '\\033[90m$ cd %s && ./run.sh\\033[0m\\n' "$2"
cd && cd "$1" && ./run.sh
s=$?
[ "$3" = close ] && [ "$s" = 0 ] && exit 0
printf '\\033[90m[run.sh ended (status %s); ./run.sh runs it again]\\033[0m\\n' "$s"
exec "\${SHELL:-/bin/sh}" -l`;

/** Resolves once http://localhost:port answers at all (any status), or rejects after timeout ms. */
export async function waitPort(vm: KernelHandle, port: number, timeout: number, signal?: AbortSignal) {
	const end = performance.now() + timeout;
	for (;;) {
		signal?.throwIfAborted();
		try {
			const r = await vm.fetch(`http://localhost:${port}/`, { method: "HEAD", signal: AbortSignal.timeout(5000) });
			await r.body?.cancel();
			return;
		} catch {
			if (performance.now() > end) throw new Error(`nothing answered on port ${port} within ${timeout / 1000} s`);
			await new Promise((r) => setTimeout(r, 1000));
		}
	}
}

/** ?showcase: the scripted tour of the apps, for a recording (showcase.ts). Called once the guest is up (boot.ts). */
export function showcaseFromUrl(): void {
	const v = new URLSearchParams(location.search).get("showcase");
	if (v === null || v === "0") return;
	void import("./showcase.ts").then((m) => m.runShowcase(v), (e) => KW.ui?.toast(`showcase: ${(e as Error)?.message ?? e}`));
}

/** Apps between the click and their window appearing (checked, their files being written). */
const starting = new Set<string>();

/** The terminal an app runs in (named after it), if one is open. */
export const appTerminal = (d: AppDef) => KW.windows?.list().find((w) => w.n !== 0 && w.name === d.id);

/**
 * Run an app: a page app opens (or shows) its window; a terminal app runs in
 * a new terminal (see the top of this file), after its installer when it
 * lacks something, or its terminal (or its installer) is shown if it already
 * has one: an app runs once at a time. Failures are toasts, or the
 * installer's. Resolves once the app runs (with ports: once the preview
 * opened or failed), or the installer was cancelled or closed.
 */
export async function launch(d: AppDef): Promise<void> {
	const ui = KW.ui!;
	const why = unavailable(d);
	if (why) { ui.toast(`${d.title}: ${why}`); return; }
	if (isPageApp(d)) { d.open(); return; }
	const vm = KW.vm as KernelHandle | undefined;
	if (!KW.windows || !vm) { ui.toast("The system is not running yet"); return; }
	const open = appTerminal(d);
	if (open) return selectTerminal(open.n);
	if (showInstaller(d.id)) return;
	if (starting.has(d.id)) return;
	// Held (paused, suspended in the background), the guest answers nothing until it goes on.
	if (isHeld(ui$().get())) { ui.toast(`${d.title}: the system is paused; it opens once the system goes on`); return; }
	const dir = d.dir ?? `~/.apps/${d.id}`;
	starting.add(d.id);
	try {
		let plan: Plan;
		try {
			plan = await planApp(vm, d, dir);
		} finally {
			starting.delete(d.id);
		}
		if (needsWork(plan)) {
			let first: Plan | undefined = plan;
			// Its descriptor as a terminal app's (appwindows.ts appMeta()): its pinned Dock tile stands for the installer.
			const meta = { id: d.id, title: d.title, glyph: d.icon };
			const ok = await runInstall(d, meta, createElement(Installer, { id: d.id }), (ctl) => {
				const p = first;
				first = undefined; // a retry checks again
				return prepare(vm, d, dir, ctl, p);
			});
			if (!ok) return;
			if (appTerminal(d)) return; // started meanwhile (run.sh by hand does not name a terminal, but a second launch might)
		} else {
			starting.add(d.id);
			try {
				// The default dir was ~/demos/<id> before: an existing one moves (DIR_SH).
				await writeFiles(vm, dir, await appFiles(d), d.dir ? "" : `demos/${d.id}`);
			} catch (e) {
				starting.delete(d.id);
				throw e;
			}
		}
		await start(vm, d, dir);
	} catch (e) {
		ui.toast(`${d.title}: ${(e as Error)?.message ?? e}`);
	}
}

/** Step 3 and 4 at the top of this file: the app's terminal, then its ports. */
async function start(vm: KernelHandle, d: TerminalApp, dir: string): Promise<void> {
	const ui = KW.ui!;
	starting.add(d.id);
	if (d.awake) keepAwake((m) => ui.hostLog(m));
	const wayland = !!d.needs?.wayland;
	try {
		// sh -l, so run.sh gets the login environment (PATH, the apk hooks).
		// An app whose terminal is the app itself (terminal: "window") gets a Terminal window of its own.
		// A Wayland app's terminal is only its log: it closes with the app when run.sh ends well (WRAP_SH's "close"), and stays after a failure.
		// A Wayland app's window is the app, but it can take a while to appear: its terminal (the log) shows until then, and the window takes the focus when it maps.
		const opened = KW.windows!.open({
			name: d.id, file: "/bin/sh", args: ["-lc", WRAP_SH, "sh", dir.replace(/^~\//, ""), dir, ...(wayland ? ["close"] : [])],
			window: d.terminal === "window" ? "new" : undefined,
		});
		starting.delete(d.id); // the terminal is listed from here on
		const info = await opened;
		if (wayland && d.terminal === "window" && info.window) wm.minimize(info.window);
	} finally {
		starting.delete(d.id);
	}
	// The app may take a while to start serving.
	await Promise.all((d.ports ?? []).map(async (port, i) => {
		await waitPort(vm, port, 600_000);
		if (i === 0) KW.preview?.open(port);
		else ui.toast(`${d.title}: port ${port} answers too (${PREFIX} ${keyFor("preview")}, then change the port)`);
	}));
}
