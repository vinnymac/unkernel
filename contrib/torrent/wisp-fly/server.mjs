// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// Wisp server (wisp-js) behind a password in the URL: wss://HOST/PASSWORD/ is the Wisp
// endpoint (a browser's WebSocket can send no header, so the URL carries it), and
// https://HOST/PASSWORD/status says whether the VPN is up, what start.sh found in its
// config (shape only) and which address the internet sees. The password is the secret
// WISP_PASS, else WISP_PATH. /health, open to all, says only that the server runs.
// Every other URL goes to the unkernel page that start.sh builds from PAGE_REPO
// (its Nitro server on 127.0.0.1:PAGE_PORT), so the page and its proxy share an origin.
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
wisp.options.dns_result_order = "ipv4first";
// start.sh's tunnel endpoint is on loopback, reached through Wisp as "kw-tunnel".
const tunnelUp = process.env.WISP_TUNNEL === "up";
wisp.options.allow_loopback_ips = tunnelUp;
const pass = (process.env.WISP_PASS || process.env.WISP_PATH || "").trim();
if (pass.length < 12) { console.error("WISP_PASS must be at least 12 characters"); }
const digest = (t) => createHash("sha256").update(t).digest();
/** The rest of the URL after /PASSWORD/, or null when the password is wrong. */
const authed = (url) => {
	const m = /^\/([^/?]+)(?:\/(.*))?$/.exec(url ?? "");
	if (!m || pass.length < 12) return null;
	let given; try { given = decodeURIComponent(m[1]); } catch { return null; }
	return timingSafeEqual(digest(given), digest(pass)) ? m[2] ?? "" : null;
};
/** How a rejected URL differs from the password, for /health: its shape only. */
const mismatch = (url) => {
	const seg = /^\/([^/?]*)/.exec(url ?? "")?.[1] ?? "";
	let given = seg; try { given = decodeURIComponent(seg); } catch { /* as sent */ }
	if (!given) return "no password in the URL";
	if (given.length !== pass.length) return given.length < pass.length ? "shorter than the password" : "longer than the password";
	return given.toLowerCase() === pass.toLowerCase() ? "letter case differs" : "same length, different characters";
};
const vpn = process.env.WISP_VPN ?? "off";
const egress = () => new Promise((resolve) => {
	const q = https.get("https://api.ipify.org", { family: 4, timeout: 8000 }, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => resolve(b.trim())); });
	q.on("timeout", () => q.destroy(new Error("timeout"))); q.on("error", (e) => resolve("error: " + e.message));
});
const tunnel = () => {
	try {
		const hs = Number(execFileSync("wg", ["show", "wg0", "latest-handshakes"]).toString().trim().split(/\s+/)[1] ?? 0);
		const [, rx, tx] = execFileSync("wg", ["show", "wg0", "transfer"]).toString().trim().split(/\s+/);
		return { handshake: hs ? `${Math.round(Date.now() / 1000 - hs)} s ago` : "never", received: Number(rx), sent: Number(tx) };
	} catch { return null; }
};
/** The page's server, once start.sh has built it (it writes /tmp/page-state: building, up COMMIT, failed). */
const PAGE_PORT = Number(process.env.PAGE_PORT ?? 3000);
const pageState = () => { try { return readFileSync("/tmp/page-state", "utf8").trim(); } catch { return "off"; } };
const toPage = (q, r) => {
	const state = pageState();
	if (!state.startsWith("up")) {
		r.writeHead(state === "off" ? 404 : 503, { "Content-Type": "text/plain", "Retry-After": "20" });
		r.end(state === "off" ? "" : state === "failed" ? "The page failed to build; see /health.\n" : "The page is still building (a few minutes after a restart). Reload shortly.\n");
		return;
	}
	const up = http.request({ host: "127.0.0.1", port: PAGE_PORT, method: q.method, path: q.url, headers: q.headers }, (u) => { r.writeHead(u.statusCode, u.headers); u.pipe(r); });
	up.on("error", () => { if (!r.headersSent) r.writeHead(502); r.end(); });
	q.pipe(up);
};
/** Counts for /health: enough to see why a page cannot connect, nothing about who or where to. */
const seen = { accepted: 0, wrongPassword: 0, refusedVpnDown: 0, lastAccepted: null, lastRejected: null, origins: {}, rejectedBecause: {} };
/** The guest tunnel endpoint (start.sh): whether a guest is attached and how much it has carried. */
const guestTunnel = () => {
	if (!tunnelUp) return process.env.WISP_TUNNEL ?? "off";
	try {
		const up = readFileSync("/sys/class/net/tun0/carrier", "utf8").trim() === "1";
		return { attached: up, received: Number(readFileSync("/sys/class/net/tun0/statistics/rx_bytes", "utf8")), sent: Number(readFileSync("/sys/class/net/tun0/statistics/tx_bytes", "utf8")) };
	} catch { return { attached: false }; }
};
// For a client that came through Wisp (so with the password): the tunnel's key and resolver.
if (tunnelUp) http.createServer((q, r) => {
	const f = q.url === "/key" ? "/app/tunnel/id" : q.url === "/dns" ? "/app/tunnel/dns" : null;
	if (!f) { r.writeHead(404); r.end(); return; }
	r.writeHead(200, { "Content-Type": "text/plain" }); r.end(readFileSync(f));
}).listen(2223, "127.0.0.1");
const s = http.createServer(async (q, r) => {
	if (q.url === "/health") {
		r.writeHead(200, { "Content-Type": "application/json" });
		r.end(JSON.stringify({ ok: true, auth: pass.length < 12 ? "none: refusing everything" : process.env.WISP_PASS ? "WISP_PASS" : "WISP_PATH", vpn,
			handshake: vpn === "off" ? null : tunnel()?.handshake ?? null, guestTunnel: guestTunnel(), page: pageState(), wisp: seen }) + "\n");
		return;
	}
	if (authed(q.url) !== "status") { toPage(q, r); return; }
	let report = [];
	try { report = readFileSync("/tmp/vpn-report.txt", "utf8").trim().split("\n").filter(Boolean); } catch { /* none */ }
	r.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
	r.end(JSON.stringify({ vpn, egress: await egress(), region: process.env.FLY_REGION, tunnel: vpn === "off" ? null : tunnel(), report }, null, 1) + "\n");
});
// A VPN that was asked for and is not up: no Wisp, rather than Fly's own address.
s.on("upgrade", (q, sock, head) => {
	const now = new Date().toISOString(), origin = String(q.headers.origin ?? "none").slice(0, 80);
	seen.origins[origin] = (seen.origins[origin] ?? 0) + 1;
	if (authed(q.url) === null) {
		const why = mismatch(q.url);
		seen.wrongPassword++; seen.lastRejected = now; seen.rejectedBecause[why] = (seen.rejectedBecause[why] ?? 0) + 1;
		sock.destroy();
	}
	else if (vpn === "failed") { seen.refusedVpnDown++; seen.lastRejected = now; sock.destroy(); }
	else {
		seen.accepted++; seen.lastAccepted = now;
		// wisp-js serves Wisp only on a path that ends in "/": add it when the URL left it out.
		q.url = q.url.replace(/^(\/[^/?]+)\/?.*$/, "$1/");
		wisp.routeRequest(q, sock, head);
	}
});
s.listen(8080, "0.0.0.0", () => console.log("wisp listening, vpn " + vpn));
