// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// Downloads from the guest preview. A browser's own download does not always
// go through the service worker (Safari's download manager asks the network,
// so it saves this page's server's answer instead of the guest's file), and
// a phone kills a page that holds some hundreds of MiB in memory. So the
// service worker (vm-sw.js) puts this script into each HTML document it
// relays, and answers a navigation that would be a download (an attachment,
// or a type no browser shows) with a small document that runs it. Either
// way save() fetches the file itself, which does go through the relay, into
// the origin's private on-disk storage (OPFS, directory kw-save, under a
// name of its own; copies older than KEEP_MS are deleted when a save
// starts, since the browser may still be copying a newer one), and then has
// the browser download that copy from a blob: link, which every engine does
// by itself.
//   - a plain click on <a download href> of this origin that the page's own
//     handlers left alone: saved here instead;
//   - the saver document: <script src="/vm-save.js" data-kw-save="1"
//     data-kw-name data-kw-size>, which saves location.href.
// OPFS is written through a worker's synchronous handle, else through
// createWritable(); without OPFS the file is kept in memory (asked first
// above 200 MiB).
//
// A plain script, not a module, and not part of the TypeScript build, like vm-sw.js.
(() => {
	"use strict";
	const script = document.currentScript;
	const DIR = "kw-save";
	/** A copy is kept this long: the browser's own download of it may still run. */
	const KEEP_MS = 10 * 60 * 1000;
	const WORKER = `
let h, pos = 0;
onmessage = async (e) => {
	try {
		const m = e.data;
		if (m.op === "open") {
			const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("${DIR}", { create: true });
			h = await (await dir.getFileHandle(m.name, { create: true })).createSyncAccessHandle();
			h.truncate(0);
		} else if (m.op === "write") { pos += h.write(new Uint8Array(m.buf), { at: pos }); }
		else if (m.op === "close") { h.flush(); h.close(); }
		postMessage({ ok: true });
	} catch (err) { postMessage({ ok: false, error: String(err && err.message || err) }); }
};`;

	/**
	 * Where the bytes go while they are read: { kind, write(chunk), close() ->
	 * File, abort() }. The copy has a name of its own (a download's may be one
	 * OPFS refuses, or an earlier copy's); abort() gives the handle, the worker
	 * and the copy up.
	 */
	async function sink() {
		try {
			if (!navigator.storage || !navigator.storage.getDirectory) throw new Error("no OPFS");
			const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(DIR, { create: true });
			for await (const [n, h] of dir.entries()) {
				try { if (Date.now() - (await h.getFile()).lastModified > KEEP_MS) await dir.removeEntry(n); } catch { /* in use */ }
			}
			const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
			const fh = await dir.getFileHandle(id, { create: true });
			const drop = () => dir.removeEntry(id).catch(() => {});
			const writable = async () => {
				const w = await fh.createWritable();
				return { kind: "disk (stream)", write: (c) => w.write(c), close: async () => { await w.close(); return fh.getFile(); }, abort: async () => { await w.abort().catch(() => {}); await drop(); } };
			};
			// The worker's handle is several times faster than the stream (measured in Chromium);
			// a document whose CSP refuses the worker gets the stream.
			let wk, src;
			try {
				src = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
				wk = new Worker(src);
			} catch (e) {
				if (src) URL.revokeObjectURL(src);
				if (fh.createWritable) return await writable();
				throw e;
			}
			const stop = () => { wk.terminate(); URL.revokeObjectURL(src); };
			// One call at a time (save() awaits each), so one pending answer.
			const call = (m, t) => new Promise((res, rej) => {
				wk.onmessage = (e) => (e.data.ok ? res() : rej(new Error(e.data.error)));
				wk.onerror = (e) => rej(new Error(e.message || "worker failed"));
				wk.postMessage(m, t || []);
			});
			try { await call({ op: "open", name: id }); } catch (e) { stop(); if (fh.createWritable) return await writable(); await drop(); throw e; }
			return {
				kind: "disk (worker)",
				write: (c) => { const buf = c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength); return call({ op: "write", buf }, [buf]); },
				close: async () => { await call({ op: "close" }); stop(); return fh.getFile(); },
				abort: async () => { await call({ op: "close" }).catch(() => {}); stop(); await drop(); },
			};
		} catch (e) {
			let parts = [];
			return { kind: `memory (${e.message})`, write: async (c) => { parts.push(c); }, close: async () => new Blob(parts), abort: async () => { parts = []; } };
		}
	}

	const mib = (n) => `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MiB`;
	/** The file name a response's Content-Disposition gives (RFC 6266), or "". */
	const headerName = (cd) => {
		const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd ?? "")?.[1];
		if (star) { try { return decodeURIComponent(star.trim()); } catch { /* the plain one */ } }
		const plain = /filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i.exec(cd ?? "");
		return plain ? (plain[1] !== undefined ? plain[1].replace(/\\(.)/g, "$1") : plain[2].trim()) : "";
	};
	/** A file name for a URL's last segment. */
	const nameOf = (u) => { try { return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "") || "download"; } catch { return "download"; } };

	/** The bar at the bottom of the document that a save reports in. */
	function bar() {
		const el = document.createElement("div");
		el.id = "kw-save-bar";
		el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;gap:.75em;align-items:center;padding:.75em 1em;" +
			"font:15px/1.3 system-ui,sans-serif;background:#111;color:#eee;border-top:1px solid #333;box-shadow:0 -2px 12px #0006";
		const label = Object.assign(document.createElement("span"), { style: "flex:1;min-width:0;overflow-wrap:anywhere" });
		const btn = (text) => Object.assign(document.createElement("button"), { textContent: text, style: "font:inherit;padding:.4em .9em;border-radius:.5em;border:1px solid #0a7;background:#0a7;color:#fff" });
		const save = btn("Save"), close = btn("Close");
		close.style.background = "transparent"; close.style.borderColor = "#555"; close.style.color = "#ccc";
		save.hidden = true;
		close.onclick = () => el.remove();
		el.append(label, save, close);
		(document.body ?? document.documentElement).append(el);
		return { el, label, save, close };
	}

	let busy = false;
	/**
	 * Read url into the scratch copy, then have the browser download that.
	 * The name: the one given, else the response's (Content-Disposition),
	 * else the URL's last segment. Resolves with { name, size, kind, file } or throws.
	 */
	async function save(url, given, size) {
		if (busy) {
			const l = document.querySelector("#kw-save-bar span");
			if (l && !/one at a time/.test(l.textContent)) l.textContent += " (one at a time: wait for this one)";
			throw new Error("another download is being read");
		}
		busy = true;
		document.getElementById("kw-save-bar")?.remove();
		const ui = bar();
		let name = given || nameOf(new URL(url, location.href));
		let out = null;
		try {
			ui.label.textContent = `Reading ${name}…`;
			const r = await fetch(url, { headers: { accept: "*/*" } });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			if (!given) name = (headerName(r.headers.get("content-disposition")) || name).replace(/[/\\]/g, "_");
			out = await sink();
			const total = Number(r.headers.get("content-length")) || size || 0;
			if (out.kind.startsWith("memory") && total > 200 * 1048576 &&
				!confirm(`This browser cannot buffer the download on disk, and ${mib(total)} may not fit in memory: the page may reload. Go on?`)) throw new Error("not read");
			let got = 0, shown = 0;
			for (const rd = r.body.getReader();;) {
				const { done, value } = await rd.read();
				if (done) break;
				await out.write(value); got += value.length;
				if (got - shown >= 1048576) { shown = got; ui.label.textContent = `Reading ${name}: ${mib(got)}${total ? ` of ${mib(total)}` : ""}`; }
			}
			const length = Number(r.headers.get("content-length")) || 0;
			if (length && got !== length && !r.headers.get("content-encoding")) throw new Error(`the guest sent ${got} of ${length} bytes`);
			const kind = out.kind;
			const stored = await out.close();
			out = null; // closed: nothing to abort
			if (stored.size !== got) throw new Error(`stored ${stored.size} of ${got} bytes`);
			const file = new File([stored], name, { type: "application/octet-stream" }); // a reference, not a copy
			const go = () => {
				const href = URL.createObjectURL(file);
				const a = Object.assign(document.createElement("a"), { href, download: name });
				(document.body ?? document.documentElement).append(a); a.click(); a.remove();
				setTimeout(() => URL.revokeObjectURL(href), KEEP_MS); // the browser copies it meanwhile
			};
			// One tap is enough where the browser lets a page start a download after the read; else Save does, with a tap of its own.
			ui.label.textContent = `${name} (${mib(got)}) is ready. If no download started, tap Save.`;
			ui.save.hidden = false; ui.save.onclick = go;
			go();
			const done = { name, size: got, kind, file };
			window.kwSaved = done;
			return done;
		} catch (e) {
			await out?.abort().catch(() => {});
			ui.label.textContent = `${name}: not saved (${e.message})`;
			throw e;
		} finally {
			busy = false;
		}
	}
	window.kwSave = save;

	// <a download href>, of this origin: here instead of the browser's own
	// download. Last of all (the bubble phase, on the document), so that a
	// page's own handlers ran first: a click one of them took (preventDefault)
	// or one with a modifier key is not ours.
	document.addEventListener("click", (e) => {
		const a = e.target instanceof Element ? e.target.closest("a[download]") : null;
		if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
		let u;
		try { u = new URL(a.href, location.href); } catch { return; }
		if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return;
		e.preventDefault();
		save(u.href, a.getAttribute("download") || "").catch(() => {});
	});

	// The saver document.
	if (script?.dataset.kwSave) {
		const start = () => save(location.href, script.dataset.kwName || nameOf(new URL(location.href)), Number(script.dataset.kwSize) || 0).catch(() => {});
		if (document.readyState === "loading") addEventListener("DOMContentLoaded", start); else start();
	}
})();
