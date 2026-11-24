// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// Page entry: read the configuration from the URL (config.ts), set up the
// chrome (ui.ts, and its React components in components/: the desktop
// replaces index.html's static first paint of it in the same frame), run the
// feature preflight with the SDK's checkSupport() while the boot module
// (boot.ts: wterm, the kernel) loads, and start that module only once the
// preflight passed. A browser without JSPI gets System's Errors with the
// reason and a hint, without downloading the kernel; a boot module that
// fails to load is reported the same way.
import { flushSync } from "react-dom";
import "./awake.ts";
import { createRoot } from "react-dom/client";
import { App } from "./components/App.tsx";
import { readConfig } from "./config.ts";
import { initDrop } from "./drop.ts";
import { KW } from "./kw.ts";
import { previewEscape } from "./preview.ts";
import { checkSupport } from "./sdk.ts";
import { browser, createUi } from "./ui.ts";

// A guest page in the preview followed a root-relative link out of
// /vm/<id>/<port>/ and the server sent this page: back under the prefix,
// without booting a second kernel here (preview.ts).
const back = previewEscape();
if (back) {
	location.replace(back);
	await new Promise(() => {});
}

// A macOS window has round bottom corners, which the Dock runs into
// (style.css, .mac-window); a fullscreen window covers the whole screen and
// has none. An iPad reports Macintosh too, with touch points.
if (/Macintosh/.test(navigator.userAgent) && !navigator.maxTouchPoints) {
	const fit = () => document.documentElement.classList.toggle("mac-window",
		!document.fullscreenElement && !matchMedia("(display-mode: fullscreen)").matches && window.outerHeight < screen.height);
	fit();
	addEventListener("resize", fit);
	document.addEventListener("fullscreenchange", fit);
}

const cfg = (KW.config = readConfig());
const ui = createUi(cfg);
KW.ui = ui;
// Rendered at once (it replaces index.html's static desktop, which it draws
// the same), so boot.ts finds the terminal's element.
flushSync(() => createRoot(document.getElementById("root")!).render(<App />));
initDrop();

async function preflight(): Promise<boolean> {
	ui.stage("preflight", "active");
	ui.bootStep("Checking the browser");
	let fatalFail: { title: string; why: string } | null = null;
	const need = (id: string, label: string, ok: boolean, why: string, title: string) => {
		ui.check(id, label, ok ? "pass" : "fail", ok ? "yes" : "no", ok ? "" : why);
		if (!ok && !fatalFail) fatalFail = { title, why };
	};
	const B = browser();
	ui.check("browser", "Browser", "info", B.name + (B.v ? ` ${B.v}` : "") + (cfg.mobileUA ? " (mobile)" : ""));
	ui.check("secure", "Secure context", isSecureContext ? "pass" : "info", isSecureContext ? "yes" : `no (${location.protocol}//${location.hostname})`,
		isSecureContext ? "" : "not required: plain http on a LAN address is fine; only the clipboard and device-memory APIs are hidden");
	ui.check("coi", "Cross-origin isolated", "info", crossOriginIsolated ? "yes" : "no",
		"not required; with ?worker=1 it lets input and frames cross through shared memory instead of messages, and several CPUs (?cpus=) need it");
	const devMem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
	ui.check("devmem", "Device memory", "info", devMem ? `${devMem} GB` : "unknown", devMem ? "" : isSecureContext ? "API not supported" : "hidden on insecure origins");
	ui.check("mem", "Kernel memory", "info", `${cfg.memMiB} MiB requested`, cfg.memWhy);
	ui.check("cpu", "CPU threads", "info", String(navigator.hardwareConcurrency || "unknown"));
	// Several guest CPUs (?cpus=N, config.ts): what this load boots with, and why not more.
	ui.check("smp", "Guest CPUs", cfg.cpus > 1 ? "pass" : cfg.smpParam < 2 ? "info" : "warn",
		cfg.cpus > 1 ? `${cfg.cpus} (${cfg.resumeCpus ? "the suspended session's" : `?cpus=${cfg.smpParam}`})` : cfg.smpParam > 1 ? `1 (asked for ${cfg.smpParam})` : "1",
		cfg.smpWhy ?? (cfg.cpus > 1 ? "the SMP kernel, each CPU in a Web Worker on one shared memory"
			: cfg.smpBlocked ? `several CPUs are unavailable: ${cfg.smpBlocked}` : "Options, CPUs, boots the SMP kernel on several"));
	ui.check("input", "Input", "info", (cfg.coarse ? "touch" : "mouse/keyboard") + (navigator.maxTouchPoints ? `, ${navigator.maxTouchPoints} touch points` : ""));
	ui.check("viewport", "Viewport", "info", `${innerWidth}×${innerHeight} @${devicePixelRatio || 1}x`);
	ui.check("clipboard", "Clipboard API", navigator.clipboard ? "pass" : "info", navigator.clipboard ? "yes" : "no", navigator.clipboard ? "" : "copy/paste use a manual fallback");
	const uad = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ architecture?: string; bitness?: string }> } }).userAgentData;
	uad?.getHighEntropyValues(["bitness", "architecture"]).then((v) => {
		ui.check("arch", "Architecture", "info", `${v.architecture || "?"} ${v.bitness ? `${v.bitness}-bit` : ""}`);
	}, () => {});
	ui.check("ua", "User agent", "info", "", navigator.userAgent);

	const s = await checkSupport();
	if (cfg.simulate.includes("nojspi")) {
		s.jspi = false;
		s.problems = ["simulated failure (?simulate=nojspi): WebAssembly.Suspending is not defined (no JSPI)"];
	}
	need("wasm", "WebAssembly", s.wasm, "WebAssembly is unavailable (disabled by policy or a very old browser)", "WebAssembly unavailable");
	need("bigint", "BigInt", s.bigint, "BigInt is required for 64-bit WebAssembly values", "Browser too old");
	need("jspi", "JSPI", s.jspi, s.problems.find((p) => /JSPI/.test(p)) ?? s.problems.join("; ") ?? "", "No JSPI (WebAssembly stack switching)");
	const f = fatalFail as { title: string; why: string } | null;
	if (f) {
		ui.stage("preflight", "fail", f.why);
		ui.fail("preflight", f.why, "", { title: f.title });
		return false;
	}
	ui.stage("preflight", "done", "JSPI, BigInt");
	return true;
}

// Errors that happened before this module ran.
for (const e of KW.errors.slice()) ui.onError(e);

if (ui.state() !== "error") {
	// Fetched while the preflight runs (it has no side effects until start()); its failure counts only once the preflight passed.
	const boot = import("./boot.ts");
	boot.catch(() => {});
	preflight().then(async (ok) => {
		if (!ok) return;
		ui.bootStep("Loading");
		const timer = setTimeout(() => {
			if (!KW.started) ui.fail("watchdog", "The boot module did not start within 20 s", "No error was reported; module scripts may be blocked or very slow to load.");
		}, 20000);
		let mod: typeof import("./boot.ts");
		try {
			mod = await boot;
		} catch (e) {
			clearTimeout(timer);
			ui.fail("resource", `Failed to load the boot module (boot.ts, wterm and the kernel runtime): ${(e as Error).message}`, (e as Error).stack, { title: "A page script failed to load" });
			return;
		}
		clearTimeout(timer);
		mod.start();
	}, (e: Error) => ui.fail("preflight", `Feature check crashed: ${e.message}`, e.stack));
}
