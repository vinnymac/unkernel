// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// NetStack backend for Node: real TCP and UDP sockets and the host resolver.
//
// The guest reaches whatever this machine can reach, as this process. Use
// it with `new NetStack({ backend: directBackend(), hostLoopback: true })`
// to also let TCP to the gateway (10.0.2.2) reach 127.0.0.1.
import net from "node:net";
import dns from "node:dns";
import dgram from "node:dgram";
import type { NetBackend } from "../core/net.ts";
import { wispBackend as coreWispBackend, type WispBackend, type WispBackendOptions } from "../core/net-wisp.ts";

/**
 * Handshake headers the Node entry's wispBackend() sends unless `headers`
 * is given. Node's WebSocket sends no Origin, and the project's server
 * (DEFAULT_WISP_SERVERS) accepts only pages from localhost or 127.0.0.1.
 */
export const NODE_WISP_HEADERS: Readonly<Record<string, string>> = Object.freeze({ Origin: "http://localhost" });

/** wispBackend() with `headers` defaulting to NODE_WISP_HEADERS. */
export function wispBackend(url: string | readonly string[], opts: WispBackendOptions = {}): WispBackend {
	return coreWispBackend(url, { ...opts, headers: opts.headers ?? { ...NODE_WISP_HEADERS } });
}

const CONNECT_TIMEOUT_MS = 20000;

export function directBackend(): NetBackend {
	const sockets = new Set<net.Socket>();
	const udpSockets = new Set<dgram.Socket>();
	return {
		connect({ host, port }, ev) {
			const s = net.connect({ host, port, allowHalfOpen: true, noDelay: true });
			sockets.add(s);
			let closed = false;
			const timer = setTimeout(() => s.destroy(new Error("connect timeout")), CONNECT_TIMEOUT_MS);
			s.on("connect", () => { clearTimeout(timer); ev.onConnect(); });
			s.on("data", (b: Buffer) => ev.onData(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
			s.on("end", () => ev.onEnd());
			s.on("drain", () => ev.onDrain());
			s.on("error", () => {});
			s.on("close", () => {
				clearTimeout(timer);
				sockets.delete(s);
				if (closed) return;
				closed = true;
				ev.onClose(s.errored ?? null);
			});
			return {
				write: (u8) => { s.write(u8); },
				end: () => { s.end(); },
				destroy: () => { closed = true; s.destroy(); },
				pause: () => { s.pause(); },
				resume: () => { s.resume(); },
				get buffered() { return s.writableLength; },
			};
		},
		udp({ host, port }, ev) {
			// A connected socket: only this remote's datagrams arrive, and its ICMP errors do.
			const s = dgram.createSocket("udp4");
			let closed = false, ready = false;
			const queue: Uint8Array[] = [];
			const done = (err: Error | null) => {
				if (closed) return;
				closed = true;
				udpSockets.delete(s);
				try { s.close(); } catch { /* not running */ }
				ev.onClose(err);
			};
			udpSockets.add(s);
			s.on("message", (b: Buffer) => { if (!closed) ev.onMessage(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)); });
			s.on("error", (e) => done(e));
			s.on("close", () => done(null));
			s.connect(port, host, () => {
				ready = true;
				for (const d of queue.splice(0)) s.send(d, sendError);
			});
			function sendError(e: Error | null) { if (e) done(e); }
			return {
				send(u8) {
					if (closed) return;
					if (ready) s.send(u8, sendError);
					else if (queue.length < 32) queue.push(u8);
				},
				close() {
					if (closed) return;
					closed = true;
					udpSockets.delete(s);
					try { s.close(); } catch { /* not running */ }
				},
			};
		},
		lookup(name) {
			return new Promise((resolve, reject) => {
				dns.lookup(name, { family: 4, all: true }, (err, addrs) => {
					if (err) reject(err);
					else resolve(addrs.map((a) => a.address));
				});
			});
		},
		/** Destroy every open socket. */
		close() {
			for (const s of sockets) s.destroy();
			sockets.clear();
			for (const s of [...udpSockets]) s.close();
		},
	};
}
