// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// ?awake=1 (this load's URL only), or an app that asks for it (TerminalApp
// `awake`, launcher.ts): hold a screen wake lock while the page is shown, so
// that a phone does not lock by itself in the middle of a long download in
// the guest. A browser gives the lock up when the page is hidden
// and wants a user gesture for the first one on some engines, so it is asked
// for again on every show and on the first touch or key. It cannot keep the
// machine running once the screen is locked or the browser is in the
// background: a phone freezes the page then, wake lock or not.

type Sentinel = { released: boolean; addEventListener(type: "release", fn: () => void): void };
type WakeLock = { request(type: "screen"): Promise<Sentinel> };

let asked = false;

/** Hold the screen on from now on (once: later calls do nothing). */
export function keepAwake(log: (msg: string) => void = () => {}): void {
	if (asked) return;
	asked = true;
	const wl = (navigator as Navigator & { wakeLock?: WakeLock }).wakeLock;
	if (!wl) { log("[host] awake: this browser has no screen wake lock"); return; }
	let held: Sentinel | null = null, said = false;
	const ask = async () => {
		if (document.visibilityState !== "visible" || (held && !held.released)) return;
		try {
			held = await wl.request("screen");
			if (!said) log("[host] awake: holding the screen on while this page is shown");
			said = true;
		} catch { /* not allowed now (hidden, low battery, no gesture yet): the next show or gesture asks again */ }
	};
	document.addEventListener("visibilitychange", () => void ask());
	for (const ev of ["pointerdown", "keydown"] as const) addEventListener(ev, () => void ask(), { passive: true });
	void ask();
}

if (new URLSearchParams(location.search).get("awake") === "1") keepAwake((m) => console.log(m));
