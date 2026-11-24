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
# In the Browser window, use its "open in a new tab" link and tap a file
# there: the browser saves it like any download (on an iPhone, to Files >
# Downloads). The file comes straight from the guest's disk, nothing leaves
# the device. Run it again after new files arrive: the list is made once.
set -eu

dir=${1:-$HOME/Downloads}
port=${SHARE_PORT:-8000}
[ -d "$dir" ] || { echo "share: no directory $dir" >&2; exit 1; }
sudo=
[ "$(id -u)" = 0 ] || sudo=sudo

# The list: every file under DIR, each a link the browser downloads.
esc() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g; s/"/\&quot;/g'; }
url() { sed 's/%/%25/g; s/ /%20/g; s/#/%23/g; s/?/%3F/g; s/"/%22/g'; }
idx=$dir/index.html
{
	echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
	echo '<title>Files from the guest</title><style>body{font:17px system-ui;margin:1.5em}li{margin:.9em 0}small{color:#777}</style>'
	echo '<h1>Files from the guest</h1><p>Tap a file to save it to this device.</p><ul>'
	(cd "$dir" && find . -type f ! -name index.html ! -name '*.part' | sed 's|^\./||' | sort) | while IFS= read -r f; do
		size=$(du -h "$dir/$f" | cut -f1)
		printf '<li><a download href="%s">%s</a> <small>%s</small></li>\n' "$(printf '%s' "$f" | url)" "$(printf '%s' "$f" | esc)" "$size"
	done
	echo '</ul>'
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
echo "share: $(grep -c '<li>' "$idx") file(s) from $dir at http://localhost:$port/" >&2
if [ "${SHARE_OPEN:-1}" = 0 ]; then :
elif command -v open >/dev/null 2>&1; then open "http://localhost:$port/" || true
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "http://localhost:$port/" || true
else echo "share: open the page's Browser window (Ctrl-A p, or Settings > Network > preview) on port $port" >&2; fi
