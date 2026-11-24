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
# file out of the guest and Save keeps it (on an iPhone through the share
# sheet: Save to Files). The file comes straight from the guest's disk,
# nothing leaves the device, and it is in the page's memory once, so a file
# of several GiB does not fit a phone. Run it again after new files arrive:
# the list is made once.
set -eu

dir=${1:-$HOME/Downloads}
port=${SHARE_PORT:-8000}
[ -d "$dir" ] || { echo "share: no directory $dir" >&2; exit 1; }
sudo=
[ "$(id -u)" = 0 ] || sudo=sudo

# The list: every file under DIR. A browser's own download of a link does not
# go through the page's relay to the guest (Safari saves the page server's
# answer instead), so the list's script fetches a file itself, which does, and
# then hands the bytes over: the share sheet where there is one (an iPhone's
# "Save to Files"), else a download. The file is in the page's memory once.
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
<p>Tap <b>Get</b> to read a file out of the guest, then <b>Save</b> to keep it on this device.</p><ul>
HTML
	(cd "$dir" && find . -type f ! -name index.html ! -name '*.part' | sed 's|^\./||' | sort) | while IFS= read -r f; do
		size=$(du -h "$dir/$f" | cut -f1)
		printf '<li data-href="%s"><span>%s</span> <small>%s</small><br><button class="get">Get</button> <small class="st"></small></li>\n' \
			"$(printf '%s' "$f" | url)" "$(printf '%s' "$f" | esc)" "$size"
	done
	cat <<'HTML'
</ul>
<script>
for (const li of document.querySelectorAll("li[data-href]")) {
	const get = li.querySelector(".get"), st = li.querySelector(".st");
	const name = li.querySelector("span").textContent.split("/").pop();
	get.onclick = async () => {
		get.disabled = true;
		try {
			const r = await fetch(li.dataset.href);
			if (!r.ok) throw new Error("HTTP " + r.status);
			const total = Number(r.headers.get("content-length")) || 0, parts = [];
			let got = 0;
			for (const rd = r.body.getReader();;) {
				const { done, value } = await rd.read();
				if (done) break;
				parts.push(value); got += value.length;
				st.textContent = (got / 1048576).toFixed(1) + " MiB" + (total ? " of " + (total / 1048576).toFixed(1) : "");
			}
			const file = new File(parts, name, { type: "application/octet-stream" });
			li.kwFile = file;
			st.textContent = (got / 1048576).toFixed(1) + " MiB ready";
			get.remove();
			const save = Object.assign(document.createElement("button"), { className: "save", textContent: "Save" });
			// A fresh tap: the share sheet and downloads want one, and the read above took too long to count.
			save.onclick = async () => {
				if (navigator.canShare && navigator.canShare({ files: [file] })) {
					try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === "AbortError") return; }
				}
				const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(file), download: name });
				document.body.appendChild(a); a.click(); a.remove();
			};
			li.insertBefore(save, st);
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
