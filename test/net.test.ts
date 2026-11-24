// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// Unit tests for the SDK's user-mode network stack and its backends (direct
// sockets, Wisp), driven by synthetic guest frames.
//
//   node --test test/net.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { ip4, ip4str, type NetBackend, type NetConnectionEvents } from "../js/core/net.ts";
import { wispBackend } from "../js/core/net-wisp.ts";
import { directBackend, wispBackend as nodeWispBackend } from "../js/node/net.ts";
import { acceptWebSocket } from "./ws-server.ts";
import { GUEST, GUEST_MAC, collect, csum, echoTest, eth, ipv4, mkStack, tcp, udp, until, withWisp } from "./net-helpers.ts";

test("ARP for the gateway, none for the guest's own address", () => {
	const { stack, out } = mkStack({});
	const arp = (tip: string) => {
		const a = new Uint8Array(28);
		const dv = new DataView(a.buffer);
		dv.setUint16(0, 1); dv.setUint16(2, 0x0800); a[4] = 6; a[5] = 4; dv.setUint16(6, 1);
		a.set(GUEST_MAC, 8); dv.setUint32(14, GUEST); dv.setUint32(24, ip4(tip));
		return eth(0x0806, a, [255, 255, 255, 255, 255, 255]);
	};
	stack.send(arp("10.0.2.2"));
	stack.send(arp("10.0.2.15"));
	assert.equal(out.length, 1);
	assert.equal(out[0]!.dv.getUint16(20), 2);
	assert.deepEqual([...out[0]!.f.subarray(22, 28)], [0x52, 0x55, 10, 0, 2, 2]);
	assert.equal(ip4str(out[0]!.dv.getUint32(28)), "10.0.2.2");
});

test("DHCP discover gets an offer for 10.0.2.15 with router and DNS", () => {
	const { stack, out } = mkStack({});
	const p = new Uint8Array(244);
	p[0] = 1; p[1] = 1; p[2] = 6; p.set([1, 2, 3, 4], 4); p.set(GUEST_MAC, 28);
	new DataView(p.buffer).setUint32(236, 0x63825363);
	p.set([53, 1, 1, 255], 240);
	stack.send(udp(68, 0xffffffff, 67, p, 0));
	assert.equal(out.length, 1);
	const r = out[0]!;
	assert.equal(r.dport, 68);
	assert.equal(ip4str(r.dv.getUint32(34 + 8 + 16)), "10.0.2.15");
	const opts = [...r.payload.subarray(240)];
	assert.deepEqual(opts.slice(0, 3), [53, 1, 2]);
	const i = opts.indexOf(6);
	assert.deepEqual(opts.slice(i, i + 6), [6, 4, 10, 0, 2, 3]);
});

test("DNS A query is answered from the backend, AAAA is empty, failures map to rcodes", async () => {
	const { stack, out } = mkStack({
		lookup: async (n) => {
			if (n === "example.com") return ["93.184.215.14", "::1"];
			throw Object.assign(new Error("nx"), { code: "ENOTFOUND" });
		},
	});
	const q = (name: string, type: number, id: number) => {
		const parts = name.split(".").flatMap((l) => [l.length, ...new TextEncoder().encode(l)]);
		return Uint8Array.from([id >> 8, id & 255, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, ...parts, 0, 0, type, 0, 1]);
	};
	stack.send(udp(5353, ip4("10.0.2.3"), 53, q("example.com", 1, 7)));
	stack.send(udp(5353, ip4("10.0.2.3"), 53, q("example.com", 28, 8)));
	stack.send(udp(5353, ip4("10.0.2.3"), 53, q("nope.invalid", 1, 9)));
	await until(() => out.length === 3);
	const byId = Object.fromEntries(out.map((r) => [r.dv.getUint16(42), r]));
	const a = byId[7]!.payload;
	assert.equal(a[3]! & 15, 0);
	assert.equal(new DataView(a.buffer, a.byteOffset).getUint16(6), 1);
	assert.deepEqual([...a.subarray(a.length - 4)], [93, 184, 215, 14]);
	assert.equal(new DataView(byId[8]!.payload.buffer, byId[8]!.payload.byteOffset).getUint16(6), 0);
	assert.equal(byId[9]!.payload[3]! & 15, 3);
});

test("ping the gateway; UDP elsewhere gets port unreachable", () => {
	const { stack, out } = mkStack({});
	const icmp = Uint8Array.from([8, 0, 0, 0, 0, 1, 0, 1, 1, 2, 3, 4]);
	new DataView(icmp.buffer).setUint16(2, csum(icmp, 0, icmp.length));
	stack.send(ipv4(1, GUEST, ip4("10.0.2.2"), icmp));
	stack.send(udp(1234, ip4("1.1.1.1"), 123, new Uint8Array(48)));
	assert.equal(out.length, 2);
	assert.equal(out[0]!.icmpType, 0);
	assert.equal(out[1]!.icmpType, 3);
});

test("TCP to a refused port gets RST; unknown segment gets RST", async () => {
	const { stack, out } = mkStack(directBackend());
	const srv = createServer();
	await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
	const port = (srv.address() as AddressInfo).port;
	srv.close();
	await new Promise((r) => srv.on("close", r));
	stack.send(tcp(40000, ip4("10.0.2.2"), port, 100, 0, 2));
	await until(() => out.length === 1);
	assert.equal(out[0]!.flags, 4 | 16);
	assert.equal(out[0]!.ack, 101);
	stack.send(tcp(40001, ip4("10.0.2.2"), port, 5, 77, 16));
	assert.equal(out[1]!.flags, 4);
	assert.equal(out[1]!.seq, 77);
});

test("TCP echo through the direct backend: handshake, data both ways, close", async () => {
	await echoTest(directBackend());
});

test("TCP retransmits unacknowledged data after the RTO and respects the guest window", async () => {
	let ev!: NetConnectionEvents;
	const fake: Partial<NetBackend> = {
		connect(_, e) {
			ev = e;
			queueMicrotask(() => e.onConnect());
			return { write() {}, end() {}, destroy() {}, pause() {}, resume() {}, buffered: 0 };
		},
	};
	const { stack, out } = mkStack(fake);
	const dst = ip4("93.184.215.14");
	// No window scaling; the guest advertises 65535 but only acks the SYN.
	stack.send(tcp(40005, dst, 80, 1, 0, 2, undefined, [2, 4, 0x05, 0xb4]));
	await until(() => out.length === 1);
	const iss = out.shift()!.seq!;
	stack.send(tcp(40005, dst, 80, 2, iss + 1, 16));
	ev.onData(new Uint8Array(100 * 1024).fill(1));
	// 65535 bytes of window = 44 full segments + 1 partial.
	const first = out.splice(0);
	const sent = first.reduce((n, r) => n + r.payload.length, 0);
	assert.equal(sent, 65535);
	await until(() => out.length > 0, 2500);
	assert.equal(out[0]!.seq, iss + 1, "go back N from snd_una");
	out.splice(0);
	stack.close();
});

test("Wisp backend: fake DNS, flow-controlled writes, clean and refused closes", async () => {
	await withWisp(async (b, seen) => {
		const [ip] = await b.lookup("echo.test");
		assert.match(ip!, /^198\.1[89]\./);
		assert.deepEqual(await b.lookup("echo.test"), [ip], "stable mapping");
		assert.deepEqual(await b.lookup("1.2.3.4"), ["1.2.3.4"]);

		const c = collect(b, ip!, 7);
		// Writes in separate ticks are separate packets: more than the credit of 2.
		const parts = ["a", "b", "c", "d", "e", "bye"];
		for (const p of parts) { c.h.write(new TextEncoder().encode(p)); await new Promise((r) => setTimeout(r, 5)); }
		assert.equal(await c.closed, null);
		assert.equal(c.data, parts.join(""));
		assert.equal(c.h.buffered, 0);
		assert.deepEqual(seen.hosts, ["echo.test:7"]);

		const [bad] = await b.lookup("nope.test");
		const r = collect(b, bad!, 80);
		assert.match((await r.closed)!.message, /connection refused/);
	});
});

test("UDP is relayed per flow by a backend with udp(); a refused flow gets port unreachable", async () => {
	const flows: { addr: string; sent: string[]; ev: { onMessage(d: Uint8Array): void; onClose(e: Error | null): void }; closed: boolean }[] = [];
	const { stack, out } = mkStack({
		udp: ({ host, port }, ev) => {
			const fl = { addr: `${host}:${port}`, sent: [] as string[], ev, closed: false };
			flows.push(fl);
			return { send: (d) => { fl.sent.push(new TextDecoder().decode(d)); }, close: () => { fl.closed = true; } };
		},
	});
	const te = new TextEncoder();
	stack.send(udp(5000, ip4("93.184.215.14"), 6969, te.encode("one")));
	stack.send(udp(5000, ip4("93.184.215.14"), 6969, te.encode("two")));
	stack.send(udp(5000, ip4("10.0.2.2"), 6969, te.encode("host")));   // hostLoopback
	stack.send(udp(5000, ip4("10.0.2.9"), 6969, te.encode("subnet"))); // nothing there
	assert.deepEqual(flows.map((f) => [f.addr, f.sent]), [["93.184.215.14:6969", ["one", "two"]], ["127.0.0.1:6969", ["host"]]]);
	assert.equal(out.length, 1);
	assert.equal(out[0]!.icmpType, 3);
	out.splice(0);

	flows[0]!.ev.onMessage(te.encode("reply"));
	flows[0]!.ev.onMessage(new Uint8Array(1473)); // would need a fragment
	assert.equal(out.length, 1);
	assert.deepEqual([ip4str(out[0]!.src!), out[0]!.sport, out[0]!.dport, new TextDecoder().decode(out[0]!.payload)], ["93.184.215.14", 6969, 5000, "reply"]);
	out.splice(0);

	// The backend gives up on a flow that never answered: the guest's last datagram bounces.
	flows[1]!.ev.onClose(new Error("refused"));
	assert.equal(out.length, 1);
	assert.equal(out[0]!.icmpType, 3);
	assert.deepEqual([...out[0]!.f.subarray(42 + 20, 42 + 28)], [...udp(5000, ip4("10.0.2.2"), 6969, te.encode("host")).subarray(34, 42)], "quotes the UDP header");
	// One that did answer just goes away.
	flows[0]!.ev.onClose(new Error("gone"));
	assert.equal(out.length, 1);
	assert.equal(stack.udp.size, 0);

	stack.send(udp(5001, ip4("93.184.215.14"), 6969, te.encode("x")));
	assert.equal(stack.stats.udpOpened, 3);
	stack.close();
	assert.equal(flows[2]!.closed, true);
	assert.equal(stack.udp.size, 0);
});

test("UDP: a backend that closes a flow inside udp() leaves none behind", () => {
	const { stack, out } = mkStack({ udp: (_addr, ev) => { ev.onClose(new Error("no UDP here")); return { send() { assert.fail("sent on a closed flow"); }, close() {} }; } });
	stack.send(udp(5000, ip4("93.184.215.14"), 6969, new Uint8Array(1)));
	assert.equal(out.length, 1);
	assert.equal(out[0]!.icmpType, 3);
	assert.equal(stack.udp.size, 0);
});

test("UDP flows: the least recently used is dropped at the limit", () => {
	const closed: number[] = [];
	const { stack } = mkStack({ udp: ({ port }) => ({ send() {}, close() { closed.push(port); } }) });
	for (let p = 1001; p <= 1256; p++) stack.send(udp(5000, ip4("93.184.215.14"), p, new Uint8Array(1)));
	stack.send(udp(5000, ip4("93.184.215.14"), 1001, new Uint8Array(1))); // the oldest is fresh again
	stack.send(udp(5000, ip4("93.184.215.14"), 1257, new Uint8Array(1)));
	assert.deepEqual(closed, [1002]);
	assert.equal(stack.udp.size, 256);
	stack.close();
});

test("Wisp backend: UDP streams carry datagrams without credit; a refused one closes", async () => {
	await withWisp(async (b, seen) => {
		const { stack, out } = mkStack(b);
		const [ip] = await b.lookup("echo.test");
		const te = new TextEncoder();
		// More datagrams than the server's TCP credit of 2, the first ones before the WebSocket is up.
		for (const s of ["a", "b", "c", "d"]) stack.send(udp(5000, ip4(ip!), 6969, te.encode(s)));
		await until(() => out.length === 4);
		assert.deepEqual(out.map((o) => new TextDecoder().decode(o.payload)), ["a", "b", "c", "d"]);
		assert.deepEqual(out.map((o) => [ip4str(o.src!), o.sport, o.dport]), Array(4).fill([ip, 6969, 5000]));
		assert.deepEqual(seen.hosts, ["udp:echo.test:6969"]);
		out.splice(0);

		stack.send(udp(5000, ip4("93.184.215.14"), 53, te.encode("q")));
		await until(() => out.length === 1);
		assert.equal(out[0]!.icmpType, 3);
		assert.deepEqual(seen.hosts, ["udp:echo.test:6969", "udp:93.184.215.14:53"]);
		stack.close();
	});
});

test("direct backend: UDP reaches a host socket and back", async () => {
	const { createSocket } = await import("node:dgram");
	const srv = createSocket("udp4");
	srv.on("message", (m, r) => srv.send(Buffer.concat([Buffer.from("re:"), m]), r.port, r.address));
	await new Promise<void>((r) => srv.bind(0, "127.0.0.1", r));
	const b = directBackend();
	const { stack, out } = mkStack(b);
	stack.send(udp(5000, ip4("10.0.2.2"), srv.address().port, new TextEncoder().encode("ping")));
	await until(() => out.length === 1);
	assert.equal(new TextDecoder().decode(out[0]!.payload), "re:ping");
	assert.deepEqual([ip4str(out[0]!.src!), out[0]!.sport, out[0]!.dport], ["10.0.2.2", srv.address().port, 5000]);
	b.close!();
	srv.close();
});

test("no Wisp server: TCP is reset", async () => {
	const b = wispBackend("ws://127.0.0.1:1/");
	const { stack, out } = mkStack(b);
	stack.send(tcp(40005, ip4("93.184.215.14"), 80, 100, 0, 2));
	await until(() => out.length === 1);
	assert.equal(out[0]!.flags, 4 | 16);
});

test("Wisp backend races several servers: a silent one loses", async () => {
	// Accepts the WebSocket but never sends the handshake CONTINUE.
	const silent = createHttpServer();
	silent.on("upgrade", (req, socket, head) => acceptWebSocket(req, socket, head, () => {}, () => {}));
	await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
	try {
		await withWisp(async (_b, _seen, url) => {
			const logs: string[] = [];
			const b = wispBackend([`ws://127.0.0.1:${(silent.address() as AddressInfo).port}/`, "ws://127.0.0.1:1/", url], { log: (m) => logs.push(m) });
			const [ip] = await b.lookup("echo.test");
			const c = collect(b, ip!, 9);
			c.h.write(new TextEncoder().encode("hi bye"));
			assert.equal(await c.closed, null);
			assert.equal(c.data, "hi bye");
			assert.ok(logs.some((m) => m.includes(`wisp connected: ${url}`)), logs.join("\n"));
			b.close();
		});
	} finally {
		silent.closeAllConnections();
		silent.close();
	}
});

test("Wisp backend: close() during the handshake gives up at once", async () => {
	const silent = createHttpServer();
	silent.on("upgrade", (req, socket, head) => acceptWebSocket(req, socket, head, () => {}, () => {}));
	await new Promise<void>((r) => silent.listen(0, "127.0.0.1", r));
	try {
		const b = wispBackend(`ws://127.0.0.1:${(silent.address() as AddressInfo).port}/`);
		const c = collect(b, "1.2.3.4", 80);
		await new Promise((r) => setTimeout(r, 100));
		const t0 = Date.now();
		b.close();
		assert.match((await c.closed)!.message, /unavailable/);
		assert.ok(Date.now() - t0 < 2000, "no wait for the handshake timeout");
	} finally {
		silent.closeAllConnections();
		silent.close();
	}
});

test("Wisp handshake headers: the Node entry sends Origin: http://localhost, overridable", async () => {
	const origins: Array<string | undefined> = [];
	const srv = createHttpServer();
	srv.on("upgrade", (req, socket) => { origins.push(req.headers.origin); socket.destroy(); });
	await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
	const url = `ws://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
	try {
		for (const b of [wispBackend(url), nodeWispBackend(url), nodeWispBackend(url, { headers: { Origin: "http://127.0.0.1:8080" } })]) {
			await assert.rejects(b.lookup("example.com").then(() => collect(b, "198.18.0.1", 80).closed.then((e) => { throw e; })));
			b.close();
		}
		assert.deepEqual(origins, [undefined, "http://localhost", "http://127.0.0.1:8080"]);
	} finally {
		srv.closeAllConnections();
		srv.close();
	}
});
