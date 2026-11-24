#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Vincent Taverna
# share.sh [DIR]: get files out of an unkernel guest and onto the device the
# page runs on. It serves DIR (default ~/Downloads) on the guest's port 8000
# with a page of download links and opens it in the page's Browser window
# (the guest preview, which the page relays to a server in the guest):
#
#   curl -fsSL https://raw.githubusercontent.com/vinnymac/unkernel/claude/vigilant-johnson-6zatj5/contrib/torrent/share.sh | sh
#
# In the Browser window, use its "open in a new tab" link; there, Get reads a
# file out of the guest and Download keeps it (Share offers the share sheet,
# for small files; a copy read before a reload is offered again as it is). The file comes straight from the guest's disk and
# nothing leaves the device; it needs free storage for one more copy while
# it is handed over. Run it again after new files arrive: the list is made
# once.
set -eu

dir=${1:-$HOME/Downloads}
port=${SHARE_PORT:-8000}
[ -d "$dir" ] || { echo "share: no directory $dir" >&2; exit 1; }
sudo=
[ "$(id -u)" = 0 ] || sudo=sudo

# The list: every file under DIR. A browser's own download of a link does not
# go through the page's relay to the guest (Safari saves the page server's
# answer instead), so the list's script fetches a file itself, which does, and
# then hands the file over: the share sheet where there is one (an iPhone's
# "Save to Files"), else a download. While it is read the file goes to the
# browser's private on-disk storage (OPFS), not to memory, and the copy of
# an earlier file is deleted first.
esc() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'; }
url() { sed 's/%/%25/g; s/ /%20/g; s/#/%23/g; s/?/%3F/g; s/"/%22/g'; }
idx=$dir/index.html
{
	cat <<'HTML'
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Files from the guest</title>
<style>body{font:17px system-ui;margin:1.5em}li{margin:1.2em 0;list-style:none}ul{padding:0}small{color:#777}
button{font:inherit;padding:.5em 1em;margin:.3em .3em 0 0;border-radius:.5em;border:1px solid #888;background:#eee}
button.save{background:#0a7;color:#fff;border-color:#0a7}</style>
<h1>Files from the guest</h1>
<p>Tap <b>Get</b> to read a file out of the guest, then <b>Download</b> to keep it on this device.
<b>Share</b> offers the system's share sheet instead; it suits small files (a phone may run out of
memory sharing a large one).</p><ul>
HTML
	(cd "$dir" && find . -type f ! -name index.html ! -name '*.part' | sed 's|^\./||' | sort) | while IFS= read -r f; do
		size=$(du -h "$dir/$f" | cut -f1)
		printf '<li data-href="%s" data-size="%s"><span>%s</span> <small>%s</small><br><button class="get">Get</button> <small class="st"></small></li>\n' \
			"$(printf '%s' "$f" | url)" "$(wc -c < "$dir/$f" | tr -d ' ')" "$(printf '%s' "$f" | esc)" "$size"
	done
	cat <<'HTML'
</ul>
<script>
// Where a file's bytes go while it is read: the browser's private on-disk
// storage (OPFS), so that a large file is never in memory (a phone kills a
// page that holds some hundreds of MiB). Written through a worker's
// synchronous handle, else through createWritable(); only without OPFS at
// all is the file kept in memory.
const WORKER = `
let h, pos = 0;
onmessage = async (e) => {
	try {
		const m = e.data;
		if (m.op === "open") {
			const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("kw-share", { create: true });
			h = await (await dir.getFileHandle(m.name, { create: true })).createSyncAccessHandle();
			h.truncate(0);
		} else if (m.op === "write") { pos += h.write(new Uint8Array(m.buf), { at: pos }); }
		else if (m.op === "close") { h.flush(); h.close(); }
		postMessage({ ok: true });
	} catch (err) { postMessage({ ok: false, error: String(err && err.message || err) }); }
};`;
async function sink(name) {
	const mode = new URLSearchParams(location.search).get("sink"); // for tests: memory, stream
	try {
		if (mode === "memory" || !navigator.storage || !navigator.storage.getDirectory) throw new Error("no OPFS");
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("kw-share", { create: true });
		// One file at a time is kept: an earlier one has been saved or given up.
		for await (const n of dir.keys()) await dir.removeEntry(n).catch(() => {});
		const fh = await dir.getFileHandle(name, { create: true });
		const writable = async () => {
			const w = await fh.createWritable();
			return { kind: "disk (stream)", write: (c) => w.write(c), close: async () => { await w.close(); return fh.getFile(); } };
		};
		if (mode === "stream") return await writable();
		const wk = new Worker(URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" })));
		const call = (m, t) => new Promise((res, rej) => {
			wk.onmessage = (e) => (e.data.ok ? res() : rej(new Error(e.data.error)));
			wk.onerror = (e) => rej(new Error(e.message || "worker failed"));
			wk.postMessage(m, t || []);
		});
		// The worker's handle is several times faster than the stream (measured in Chromium).
		try { await call({ op: "open", name }); } catch (e) { wk.terminate(); if (fh.createWritable) return await writable(); throw e; }
		return {
			kind: "disk (worker)",
			write: (c) => { const buf = c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength); return call({ op: "write", buf }, [buf]); },
			close: async () => { await call({ op: "close" }); wk.terminate(); return fh.getFile(); },
		};
	} catch (e) {
		const parts = [];
		return { kind: "memory (" + e.message + ")", write: async (c) => { parts.push(c); }, close: async () => new File(parts, name) };
	}
}
// A file that has been read: its two ways out. Each wants a fresh tap (the
// read took too long for the Get tap to count).
function ready(li, stored, name, kind) {
	const st = li.querySelector(".st");
	const file = new File([stored], name, { type: "application/octet-stream" }); // a reference, not a copy
	li.kwFile = file; li.kwSink = kind;
	li.querySelector(".get")?.remove();
	st.textContent = (file.size / 1048576).toFixed(1) + " MiB ready";
	const dl = Object.assign(document.createElement("button"), { className: "save", textContent: "Download" });
	dl.onclick = () => {
		const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
		document.body.appendChild(a); a.click(); a.remove();
	};
	li.insertBefore(dl, st);
	if (navigator.canShare && navigator.canShare({ files: [file] })) {
		const sh = Object.assign(document.createElement("button"), { className: "share", textContent: "Share" });
		sh.onclick = async () => {
			if (file.size > 200 * 1048576 && !confirm("Sharing " + Math.round(file.size / 1048576) + " MiB may make the browser reload this page. Download is safer. Share anyway?")) return;
			try { await navigator.share({ files: [file] }); } catch (e) { if (e.name !== "AbortError") st.textContent = "share failed: " + e.message; }
		};
		li.insertBefore(sh, st);
	}
}
// A copy read earlier (before a reload, say) is offered again without reading it twice.
(async () => {
	try {
		const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("kw-share");
		for await (const [n, h] of dir.entries()) {
			const f = await h.getFile();
			for (const li of document.querySelectorAll("li[data-href]")) {
				if (li.querySelector("span").textContent.split("/").pop() === n && Number(li.dataset.size) === f.size) ready(li, f, n, "disk (kept)");
			}
		}
	} catch { /* nothing kept */ }
})();
for (const li of document.querySelectorAll("li[data-href]")) {
	const get = li.querySelector(".get"), st = li.querySelector(".st");
	const name = li.querySelector("span").textContent.split("/").pop();
	get.onclick = async () => {
		get.disabled = true;
		try {
			// One file at a time is kept: the buttons of an earlier one go with its copy.
			for (const o of document.querySelectorAll("li[data-href]")) if (o !== li && o.kwFile) { o.kwFile = null; o.querySelectorAll(".save,.share").forEach((x) => x.remove()); o.querySelector(".st").textContent = "reload this page to read this one again"; }
			const out = await sink(name);
			const r = await fetch(li.dataset.href);
			if (!r.ok) throw new Error("HTTP " + r.status);
			const total = Number(r.headers.get("content-length")) || Number(li.dataset.size) || 0;
			if (out.kind.startsWith("memory") && total > 200 * 1048576 && !confirm("This browser cannot buffer the file on disk, and " + Math.round(total / 1048576) + " MiB may not fit in memory: the page may reload. Go on?")) throw new Error("not read");
			let got = 0, shown = 0;
			for (const rd = r.body.getReader();;) {
				const { done, value } = await rd.read();
				if (done) break;
				await out.write(value); got += value.length;
				if (got - shown >= 1048576) { shown = got; st.textContent = (got / 1048576).toFixed(0) + " MiB" + (total ? " of " + (total / 1048576).toFixed(0) : ""); }
			}
			const stored = await out.close();
			if (stored.size !== got) throw new Error("stored " + stored.size + " of " + got + " bytes");
			ready(li, stored, name, out.kind);
		} catch (e) {
			st.textContent = "failed: " + e.message; get.disabled = false;
		}
	};
}
</script>
HTML
} > "$idx"

if command -v python3 >/dev/null 2>&1; then
	serve() { cd "$dir" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1; }
elif command -v apk >/dev/null 2>&1; then
	command -v httpd >/dev/null 2>&1 || { echo "share: installing a web server (busybox-extras)" >&2; $sudo apk add busybox-extras >&2; }
	serve() { exec httpd -f -p "127.0.0.1:$port" -h "$dir"; }
else
	echo "share: installing python3 for its web server" >&2
	$sudo apt-get update >&2 && $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 >&2
	serve() { cd "$dir" && exec python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1; }
fi

# One server at a time on the port: an earlier run's is replaced.
pid=/tmp/kw-share-$port.pid
[ -f "$pid" ] && kill "$(cat "$pid")" 2>/dev/null || true
( serve ) </dev/null >/dev/null 2>&1 &
echo $! > "$pid"
sleep 1
echo "share: $(grep -c 'data-href=' "$idx") file(s) from $dir at http://localhost:$port/" >&2
if [ "${SHARE_OPEN:-1}" = 0 ]; then :
elif command -v open >/dev/null 2>&1; then open "http://localhost:$port/" || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$port/" || true
else echo "share: open the page's Browser window (Ctrl-A p, or Settings > Network > preview) on port $port" >&2; fi
