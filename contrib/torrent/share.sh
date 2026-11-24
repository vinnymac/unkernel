#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# Copyright (C) 2026 Vincent Taverna
# share.sh [DIR]: get files out of an unkernel guest and onto the device the
# page runs on. It lists what is in DIR (default ~/Downloads), a row per file
# or folder, on the guest's port 8000 and opens the list in the page's
# Browser window (the guest preview, which the page relays to the guest):
#
#   curl -fsSL https://raw.githubusercontent.com/vinnymac/unkernel/claude/vigilant-johnson-6zatj5/contrib/torrent/share.sh | sh
#
# In the Browser window, use its "open in a new tab" link; there, Download
# reads an item out of the guest and saves it to the device (an iPhone: Files
# > Downloads). A folder comes as one .zip, made as it is read (stored, not
# compressed: no second copy in the guest, little CPU). Everything stays on
# the device; it needs free storage for one more copy while it is handed
# over. The list is made on every load.
#
# How: a browser's own download of a link does not go through the page's
# relay to the guest (Safari saves the page server's answer instead), and a
# phone kills a page that holds some hundreds of MiB in memory or shares them
# through the share sheet. So the list's script fetches the item itself, into
# the browser's private on-disk storage (OPFS), and gives the browser a link
# to that copy to download; the copy of an earlier item is deleted first.
set -eu

dir=${1:-$HOME/Downloads}
port=${SHARE_PORT:-8000}
[ -d "$dir" ] || { echo "share: no directory $dir" >&2; exit 1; }
dir=$(cd "$dir" && pwd)
sudo=
[ "$(id -u)" = 0 ] || sudo=sudo

# busybox's httpd (for its CGI) and zip.
if command -v httpd >/dev/null 2>&1; then httpd=httpd
elif busybox --list 2>/dev/null | grep -qx httpd; then httpd="busybox httpd"
elif command -v apk >/dev/null 2>&1; then echo "share: installing a web server (busybox-extras)" >&2; $sudo apk add busybox-extras >&2; httpd=httpd
else echo "share: installing busybox for its web server" >&2
	$sudo apt-get update >&2 && $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends busybox >&2; httpd="busybox httpd"; fi
if ! command -v zip >/dev/null 2>&1; then
	echo "share: installing zip" >&2
	if command -v apk >/dev/null 2>&1; then $sudo apk add zip >&2
	else $sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends zip >&2; fi
fi

root=/tmp/kw-share-$port
rm -rf "$root"; mkdir -p "$root/cgi-bin"

# /cgi-bin/list: the items as lines "f|d <tab> bytes <tab> name".
cat > "$root/cgi-bin/list" <<CGI
#!/bin/sh
printf 'Content-Type: text/plain; charset=utf-8\\r\\nCache-Control: no-store\\r\\n\\r\\n'
cd '$dir' || exit 0
for n in * .[!.]*; do
	case \$n in *.part|'*'|'.[!.]*') continue ;; esac
	if [ -d "\$n" ]; then printf 'd\\t%s\\t%s\\n' "\$((\$(du -sk "\$n" | cut -f1) * 1024))" "\$n"
	elif [ -f "\$n" ]; then printf 'f\\t%s\\t%s\\n' "\$(wc -c < "\$n" | tr -d ' ')" "\$n"; fi
done
CGI
# /cgi-bin/get?NAME: a file as it is, a folder as a .zip written as it is read.
cat > "$root/cgi-bin/get" <<CGI
#!/bin/sh
n=\$($httpd -d "\$QUERY_STRING")
case \$n in ''|.|..|*/*) printf 'Status: 400 Bad Request\\r\\n\\r\\n'; exit 0 ;; esac
cd '$dir' || exit 0
if [ -d "\$n" ]; then
	printf 'Content-Type: application/zip\\r\\nCache-Control: no-store\\r\\n\\r\\n'
	exec zip -0 -q -r - "\$n" -x '*.part'
elif [ -f "\$n" ]; then
	printf 'Content-Type: application/octet-stream\\r\\nCache-Control: no-store\\r\\nContent-Length: %s\\r\\n\\r\\n' "\$(wc -c < "\$n" | tr -d ' ')"
	exec cat "\$n"
fi
printf 'Status: 404 Not Found\\r\\n\\r\\n'
CGI
chmod +x "$root/cgi-bin/list" "$root/cgi-bin/get"

cat > "$root/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Files from the guest</title>
<style>body{font:17px system-ui;margin:1.5em}li{margin:1.2em 0;list-style:none}ul{padding:0}small{color:#777}
button{font:inherit;padding:.5em 1em;margin:.3em .5em 0 0;border-radius:.5em;border:1px solid #0a7;background:#0a7;color:#fff}
button:disabled{opacity:.5}</style>
<h1>Files from the guest</h1>
<p>Download saves an item to this device. A folder comes as one zip file.</p>
<ul id="items"><li><small>Reading the list…</small></li></ul>
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
const mib = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MiB";
// The browser's own download of the on-disk copy: one tap is enough where the
// browser lets a page start a download after the read; else the button, now
// "Save", starts it with a tap of its own.
function hand(li, stored, name) {
	const file = new File([stored], name, { type: "application/octet-stream" }); // a reference, not a copy
	li.kwFile = file;
	const go = () => {
		const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
		document.body.appendChild(a); a.click(); a.remove();
	};
	const b = li.querySelector("button");
	b.textContent = "Save"; b.disabled = false; b.onclick = go;
	li.querySelector(".st").textContent = mib(file.size) + " ready. If no download started, tap Save.";
	go();
}
async function download(li, item) {
	const b = li.querySelector("button"), st = li.querySelector(".st");
	b.disabled = true;
	try {
		// One copy at a time is kept: an earlier item's row starts over.
		for (const o of document.querySelectorAll("#items li")) if (o !== li && o.kwFile) { o.kwFile = null; const ob = o.querySelector("button"); ob.textContent = "Download"; ob.onclick = o.kwStart; o.querySelector(".st").textContent = ""; }
		const out = await sink(item.save);
		li.kwSink = out.kind;
		const r = await fetch("cgi-bin/get?" + encodeURIComponent(item.name));
		if (!r.ok) throw new Error("HTTP " + r.status);
		const total = Number(r.headers.get("content-length")) || item.size;
		if (out.kind.startsWith("memory") && total > 200 * 1048576 && !confirm("This browser cannot buffer the download on disk, and " + mib(total) + " may not fit in memory: the page may reload. Go on?")) throw new Error("not read");
		let got = 0, shown = 0;
		for (const rd = r.body.getReader();;) {
			const { done, value } = await rd.read();
			if (done) break;
			await out.write(value); got += value.length;
			if (got - shown >= 1048576) { shown = got; st.textContent = "reading " + mib(got) + (total ? " of about " + mib(total) : ""); }
		}
		const stored = await out.close();
		if (stored.size !== got) throw new Error("stored " + stored.size + " of " + got + " bytes");
		hand(li, stored, item.save);
	} catch (e) {
		st.textContent = "failed: " + e.message; b.disabled = false;
	}
}
(async () => {
	const ul = document.getElementById("items");
	try {
		const text = await (await fetch("cgi-bin/list")).text();
		const items = text.split("\n").filter(Boolean).map((l) => { const [t, size, ...n] = l.split("\t"); const name = n.join("\t"); return { dir: t === "d", size: Number(size), name, save: t === "d" ? name + ".zip" : name }; });
		ul.textContent = "";
		if (!items.length) ul.innerHTML = "<li><small>Nothing here yet.</small></li>";
		// A copy read before a reload is offered as it is (a file's: its size tells; a folder is read again).
		const kept = new Map();
		try { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("kw-share"); for await (const [n, h] of d.entries()) kept.set(n, await h.getFile()); } catch { /* none */ }
		for (const item of items) {
			const li = document.createElement("li");
			li.append(Object.assign(document.createElement("span"), { textContent: item.name + (item.dir ? "/" : "") }), " ",
				Object.assign(document.createElement("small"), { textContent: (item.dir ? "folder, about " : "") + mib(item.size) }), document.createElement("br"));
			const b = Object.assign(document.createElement("button"), { textContent: "Download" });
			li.kwStart = b.onclick = () => download(li, item);
			li.append(b, Object.assign(document.createElement("small"), { className: "st" }));
			ul.append(li);
			const k = kept.get(item.save);
			if (k && !item.dir && k.size === item.size) {
				const file = new File([k], item.save, { type: "application/octet-stream" });
				li.kwFile = file; li.kwSink = "disk (kept)";
				b.textContent = "Save";
				b.onclick = () => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: item.save }); document.body.appendChild(a); a.click(); a.remove(); };
				li.querySelector(".st").textContent = mib(k.size) + " already read";
			}
		}
	} catch (e) { ul.innerHTML = "<li><small>Could not read the list: " + e.message + "</small></li>"; }
})();
</script>
HTML

# One server at a time on the port: an earlier run's is replaced.
pid=/tmp/kw-share-$port.pid
[ -f "$pid" ] && kill "$(cat "$pid")" 2>/dev/null || true
( exec $httpd -f -p "127.0.0.1:$port" -h "$root" ) </dev/null >/dev/null 2>&1 &
echo $! > "$pid"
sleep 1
echo "share: $dir at http://localhost:$port/" >&2
if [ "${SHARE_OPEN:-1}" = 0 ]; then :
elif command -v open >/dev/null 2>&1; then open "http://localhost:$port/" || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$port/" || true
else echo "share: open the page's Browser window (Ctrl-A p, or Settings > Network > preview) on port $port" >&2; fi
