// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// Wisp server (wisp-js) behind a secret path: wss://HOST/$WISP_PATH/ is the Wisp endpoint,
// https://HOST/$WISP_PATH/status says whether the VPN is up, what start.sh found in its
// config (shape only) and which address the internet sees.
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
wisp.options.dns_result_order = "ipv4first";
const prefix = "/" + process.env.WISP_PATH + "/";
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
const s = http.createServer(async (q, r) => {
	if (q.url !== prefix + "status") { r.writeHead(404); r.end(); return; }
	let report = [];
	try { report = readFileSync("/tmp/vpn-report.txt", "utf8").trim().split("\n").filter(Boolean); } catch { /* none */ }
	r.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
	r.end(JSON.stringify({ vpn, egress: await egress(), region: process.env.FLY_REGION, tunnel: vpn === "off" ? null : tunnel(), report }, null, 1) + "\n");
});
// A VPN that was asked for and is not up: no Wisp, rather than Fly's own address.
s.on("upgrade", (q, sock, head) => { if (vpn !== "failed" && q.url.startsWith(prefix)) wisp.routeRequest(q, sock, head); else sock.destroy(); });
s.listen(8080, "0.0.0.0", () => console.log("wisp listening, vpn " + vpn));
