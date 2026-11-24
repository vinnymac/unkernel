// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Vincent Taverna
// Wisp server (wisp-js) behind a secret path: wss://HOST/$WISP_PATH/ is the Wisp endpoint,
// https://HOST/$WISP_PATH/status says whether the VPN is up and which address the internet sees.
import http from "node:http";
import https from "node:https";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
wisp.options.dns_result_order = "ipv4first";
const prefix = "/" + process.env.WISP_PATH + "/";
const egress = () => new Promise((resolve) => {
	const q = https.get("https://api.ipify.org", { family: 4, timeout: 8000 }, (r) => { let b = ""; r.on("data", (d) => (b += d)); r.on("end", () => resolve(b.trim())); });
	q.on("timeout", () => q.destroy(new Error("timeout"))); q.on("error", (e) => resolve("error: " + e.message));
});
const s = http.createServer(async (q, r) => {
	if (q.url !== prefix + "status") { r.writeHead(404); r.end(); return; }
	r.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
	r.end(JSON.stringify({ vpn: !!process.env.WISP_VPN, egress: await egress(), region: process.env.FLY_REGION }) + "\n");
});
s.on("upgrade", (q, sock, head) => { if (q.url.startsWith(prefix)) wisp.routeRequest(q, sock, head); else sock.destroy(); });
s.listen(8080, "0.0.0.0", () => console.log("wisp listening"));
