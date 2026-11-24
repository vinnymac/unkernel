// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// Test helpers for the network stack: synthetic guest frames, a stack whose
// output is parsed and checksum-checked, a TCP echo run, a fake Wisp server.
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { NetStack, ip4, type NetBackend } from "../js/core/net.ts";
import { wispBackend, type WispBackend } from "../js/core/net-wisp.ts";
import { acceptWebSocket, type TestWebSocket } from "./ws-server.ts";

export const GUEST_MAC = [0x52, 0x54, 0, 0x12, 0x34, 0x56];
export const GUEST = ip4("10.0.2.15");

export function csum(u8: Uint8Array, off: number, len: number, s = 0): number {
	for (let i = 0; i < len; i += 2) s += (u8[off + i]! << 8) | (i + 1 < len ? u8[off + i + 1]! : 0);
	while (s > 0xffff) s = (s & 0xffff) + Math.floor(s / 65536);
	return ~s & 0xffff;
}

export function eth(type: number, body: Uint8Array, dst = [0x52, 0x55, 10, 0, 2, 2]): Uint8Array {
	const f = new Uint8Array(14 + body.length);
	f.set(dst, 0); f.set(GUEST_MAC, 6); f[12] = type >> 8; f[13] = type & 255;
	f.set(body, 14);
	return f;
}

export function ipv4(proto: number, src: number, dst: number, l4: Uint8Array): Uint8Array {
	const p = new Uint8Array(20 + l4.length);
	const dv = new DataView(p.buffer);
	p[0] = 0x45; dv.setUint16(2, p.length); p[8] = 64; p[9] = proto;
	dv.setUint32(12, src); dv.setUint32(16, dst);
	dv.setUint16(10, csum(p, 0, 20));
	p.set(l4, 20);
	return eth(0x0800, p);
}

export function udp(sport: number, dst: number, dport: number, payload: Uint8Array, src = GUEST): Uint8Array {
	const u = new Uint8Array(8 + payload.length);
	const dv = new DataView(u.buffer);
	dv.setUint16(0, sport); dv.setUint16(2, dport); dv.setUint16(4, u.length);
	u.set(payload, 8);
	return ipv4(17, src, dst, u);
}

export function tcp(sport: number, dst: number, dport: number, seq: number, ack: number, flags: number,
	payload = new Uint8Array(0), opts: number[] = []): Uint8Array {
	const hl = 20 + opts.length;
	const t = new Uint8Array(hl + payload.length);
	const dv = new DataView(t.buffer);
	dv.setUint16(0, sport); dv.setUint16(2, dport); dv.setUint32(4, seq); dv.setUint32(8, ack);
	t[12] = (hl / 4) << 4; t[13] = flags; dv.setUint16(14, 65535);
	t.set(opts, 20); t.set(payload, hl);
	return ipv4(6, GUEST, dst, t);
}

export interface Parsed {
	type: number;
	f: Uint8Array;
	dv: DataView;
	proto?: number;
	src?: number;
	dst?: number;
	sport?: number;
	dport?: number;
	seq?: number;
	ack?: number;
	flags?: number;
	win?: number;
	icmpType?: number;
	payload: Uint8Array;
}

export function parse(f: Uint8Array): Parsed {
	const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
	const r: Parsed = { type: dv.getUint16(12), f, dv, payload: new Uint8Array(0) };
	if (r.type === 0x0800) {
		r.proto = f[23]; r.src = dv.getUint32(26); r.dst = dv.getUint32(30);
		assert.equal(csum(f, 14, 20), 0, "ip checksum");
		const l4 = 34, len = dv.getUint16(16) - 20;
		if (r.proto === 6) {
			const ps = (r.src >>> 16) + (r.src & 0xffff) + (r.dst >>> 16) + (r.dst & 0xffff) + 6 + len;
			assert.equal(csum(f, l4, len, ps), 0, "tcp checksum");
			r.sport = dv.getUint16(l4); r.dport = dv.getUint16(l4 + 2);
			r.seq = dv.getUint32(l4 + 4); r.ack = dv.getUint32(l4 + 8); r.flags = f[l4 + 13];
			r.win = dv.getUint16(l4 + 14);
			r.payload = f.subarray(l4 + (f[l4 + 12]! >> 4) * 4, l4 + len);
		} else if (r.proto === 17) {
			r.sport = dv.getUint16(l4); r.dport = dv.getUint16(l4 + 2);
			r.payload = f.subarray(l4 + 8);
		} else if (r.proto === 1) {
			r.icmpType = f[l4];
			assert.equal(csum(f, l4, len), 0, "icmp checksum");
		}
	}
	return r;
}

export function mkStack(backend: Partial<NetBackend>): { stack: NetStack; out: Parsed[] } {
	const out: Parsed[] = [];
	const stack = new NetStack({ backend: backend as NetBackend, hostLoopback: true });
	stack.output = (f) => out.push(parse(f));
	return { stack, out };
}

export const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
	const end = Date.now() + ms;
	while (!cond()) {
		if (Date.now() > end) throw new Error("timeout");
		await new Promise((r) => setTimeout(r, 5));
	}
};

/** A 300 KB echo through `backend` to a local server: handshake, TSO-sized segments, FIN both ways. */
export async function echoTest(backend: NetBackend): Promise<void> {
	const srv = createServer({ allowHalfOpen: true }, (s) => {
		s.on("data", (d) => s.write(d));
		s.on("end", () => s.end());
	});
	await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
	const port = (srv.address() as AddressInfo).port;
	const { stack, out } = mkStack(backend);
	const gw = ip4("10.0.2.2");
	const mssWs = [2, 4, 0x05, 0xb4, 1, 3, 3, 7];
	stack.send(tcp(40002, gw, port, 1000, 0, 2, undefined, mssWs));
	await until(() => out.length === 1);
	const synack = out.shift()!;
	assert.equal(synack.flags, 2 | 16);
	assert.equal(synack.ack, 1001);
	let snd = 1001, rcv = (synack.seq! + 1) >>> 0;
	stack.send(tcp(40002, gw, port, snd, rcv, 16));

	// Large write: 300 KB, sent as 64 KB TSO-style segments.
	const data = new Uint8Array(300 * 1024).map((_, i) => (i * 7) & 255);
	for (let o = 0; o < data.length; o += 65000) {
		const chunk = data.subarray(o, o + 65000);
		stack.send(tcp(40002, gw, port, snd, rcv, 16, chunk));
		snd += chunk.length;
	}
	stack.send(tcp(40002, gw, port, snd, rcv, 17)); // FIN
	snd++;

	const got: Uint8Array[] = [];
	let gotLen = 0, finSeen = false;
	await until(() => {
		while (out.length) {
			const r = out.shift()!;
			if (r.flags! & 4) throw new Error("unexpected RST");
			if (r.payload.length) {
				assert.equal(r.seq, rcv, "in-order segment");
				assert.ok(r.payload.length <= 1460);
				got.push(r.payload.slice());
				gotLen += r.payload.length;
				rcv = (rcv + r.payload.length) >>> 0;
			}
			if (r.flags! & 1) { finSeen = true; rcv = (rcv + 1) >>> 0; }
			// ACK everything, window 64K << 7.
			stack.send(tcp(40002, gw, port, snd, rcv, 16));
		}
		return finSeen;
	}, 10000);
	const all = new Uint8Array(gotLen);
	let o = 0;
	for (const g of got) { all.set(g, o); o += g.length; }
	assert.deepEqual(all, data);
	await until(() => stack.tcp.size === 0);
	srv.close();
}

/**
 * A minimal Wisp v1 server: CONNECT to "echo.test" echoes DATA and closes
 * (reason 0x02) after "bye"; any other host is refused (0x44). The credit is
 * tiny, so the client has to wait for CONTINUE. A UDP stream (seen as
 * "udp:host:port") echoes each datagram and never sends CONTINUE.
 */
export async function withWisp(fn: (b: WispBackend, seen: { hosts: string[]; packets: number }, url: string) => Promise<void>): Promise<void> {
	const CREDIT = 2;
	const seen = { hosts: [] as string[], packets: 0 };
	const http = createHttpServer((_req, res) => res.writeHead(404).end());
	http.on("upgrade", (req, socket, head) => {
		const pkt = (type: number, id: number, payload: ArrayLike<number>) => {
			const b = Buffer.alloc(5 + payload.length);
			b[0] = type; b.writeUInt32LE(id, 1); b.set(payload, 5);
			return b;
		};
		const udpStreams = new Set<number>();
		const ws: TestWebSocket = acceptWebSocket(req, socket, head, (m) => {
			const id = m.readUInt32LE(1);
			if (m[0] === 0x01) {
				const host = m.subarray(8).toString();
				if (m[5] === 2) udpStreams.add(id);
				seen.hosts.push(`${m[5] === 2 ? "udp:" : ""}${host}:${m.readUInt16LE(6)}`);
				if (host !== "echo.test") ws.send(pkt(0x04, id, [0x44]));
			} else if (m[0] === 0x02) {
				seen.packets++;
				const data = m.subarray(5);
				ws.send(pkt(0x02, id, data));
				if (!udpStreams.has(id)) ws.send(pkt(0x03, id, [CREDIT, 0, 0, 0]));
				if (data.toString().endsWith("bye")) ws.send(pkt(0x04, id, [0x02]));
			}
		}, () => {});
		ws.send(pkt(0x03, 0, [CREDIT, 0, 0, 0]));
	});
	await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
	const url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/`;
	const b = wispBackend(url);
	try {
		await fn(b, seen, url);
	} finally {
		b.close();
		http.closeAllConnections();
		http.close();
	}
}

export const collect = (b: NetBackend, host: string, port: number) => {
	let resolveClose!: (e: Error | null) => void;
	const r = {
		data: "",
		closed: new Promise<Error | null>((res) => { resolveClose = res; }),
		h: undefined as unknown as ReturnType<NetBackend["connect"]>,
	};
	r.h = b.connect({ host, port }, {
		onConnect() {}, onEnd() {}, onDrain() {},
		onData: (u8) => { r.data += Buffer.from(u8).toString(); },
		onClose: (err) => resolveClose(err),
	});
	return r;
};

