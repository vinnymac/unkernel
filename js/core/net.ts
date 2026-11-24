// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// unkernel user-mode network stack ("slirp-lite"), shared by Node and the
// browser.
//
// The guest's kwnet device exchanges raw Ethernet frames with the host. This
// module terminates them: it answers ARP for the virtual subnet, runs a tiny
// DHCP server and DNS server, answers pings to the gateway, and terminates
// TCP connections, bridging each one to a pluggable backend (NetBackend:
// real sockets in Node, node/net.ts; a Wisp server, net-wisp.ts; or any
// other transport). UDP to other hosts is relayed by a backend that has
// udp(): one flow per (guest port, remote address, remote port).
//
//   10.0.2.0/24   virtual subnet
//   10.0.2.2      gateway (TCP to it goes to the host's loopback if the
//                 backend allows it)
//   10.0.2.3      DNS server (A queries resolved by the backend)
//   10.0.2.15     the guest (handed out by DHCP)
//
// Not implemented: IPv6, IP fragments, UDP other than DHCP/DNS with a
// backend that has no udp() (answered with ICMP port unreachable), ICMP other than echo to the gateway/DNS address,
// TCP options beyond MSS and window scale (no SACK, no timestamps).

import type { Kernel, NetDevice } from "./kernel.ts";
import { errorText } from "./output.ts";

/** Events a backend reports for one TCP connection. */
export interface NetConnectionEvents {
	onConnect(): void;
	onData(data: Uint8Array): void;
	/** The remote side half-closed (no more data). */
	onEnd(): void;
	/** Data written earlier has been sent; `buffered` went down. */
	onDrain(): void;
	/** Called once, last; null for a clean close. */
	onClose(error: Error | null): void;
}

/** The host side of one TCP connection. */
export interface NetConnection {
	write(data: Uint8Array): void;
	/** Half-close (the guest sent FIN). */
	end(): void;
	/** Abort; no events follow. */
	destroy(): void;
	/** Stop delivering onData until resume(). */
	pause(): void;
	resume(): void;
	/** Bytes written but not yet sent. */
	readonly buffered: number;
}

/** Events a backend reports for one UDP flow. */
export interface NetDatagramEvents {
	/** A datagram from the flow's remote address. */
	onMessage(data: Uint8Array): void;
	/** Called once, last, unless the stack closed the flow; null for a clean close. */
	onClose(error: Error | null): void;
}

/** The host side of one UDP flow: the guest's datagrams to one remote address and port. */
export interface NetDatagramFlow {
	send(data: Uint8Array): void;
	/** Drop the flow; no events follow. */
	close(): void;
}

/**
 * Transport for the guest's TCP connections, DNS lookups and UDP datagrams.
 *
 *   connect({ host, port }, events) -> NetConnection
 *   lookup(name) -> IPv4 dotted quads; reject with { code: "ENOTFOUND" }
 *     for NXDOMAIN, anything else becomes SERVFAIL
 *   udp({ host, port }, events) (optional) -> NetDatagramFlow; without it
 *     the guest's UDP (other than DHCP and DNS) gets ICMP port unreachable
 *   close() (optional) drops every connection and the transport
 */
export interface NetBackend {
	connect(addr: { host: string; port: number }, ev: NetConnectionEvents): NetConnection;
	lookup(name: string): Promise<string[]>;
	udp?(addr: { host: string; port: number }, ev: NetDatagramEvents): NetDatagramFlow;
	close?(): void;
}

export interface NetStackOptions {
	backend: NetBackend;
	log?: (msg: string) => void;
	/** TCP to the gateway (10.0.2.2) goes to 127.0.0.1. Default false. */
	hostLoopback?: boolean;
	/** MTU advertised by DHCP (option 26). */
	mtu?: number;
	/** The guest's MAC address, default 52:54:00:12:34:56. */
	mac?: string;
}

export interface NetStats {
	rx: number;
	tx: number;
	tcpOpened: number;
	dns: number;
	/** UDP flows opened on the backend. */
	udpOpened: number;
}

/** One relayed UDP flow (NetStack.udp). */
interface UdpFlow {
	flow: NetDatagramFlow;
	/** performance.now() of the last datagram either way. */
	last: number;
	/** The remote has answered. */
	replied: boolean;
	/** The guest's last frame up to the UDP header, for an ICMP error. */
	quote: Uint8Array;
	l4: number;
}

/** A UDP flow is dropped after this long without a datagram (shorter while the remote has never answered). */
const UDP_IDLE_MS = 60000, UDP_UNANSWERED_MS = 15000;
/** With more flows than this (a DHT client talks to hundreds of nodes), the least recently used go first. */
const UDP_MAX_FLOWS = 256;

const ETH_ARP = 0x0806, ETH_IP = 0x0800;
const PROTO_ICMP = 1, PROTO_TCP = 6, PROTO_UDP = 17;
const FIN = 1, SYN = 2, RST = 4, PSH = 8, ACK = 16;

/** A timer that does not keep a Node process alive. */
const unref = <T>(t: T): T => { (t as { unref?: () => void }).unref?.(); return t; };

export const ip4 = (s: string): number => s.split(".").reduce((a, b) => ((a << 8) | Number(b)) >>> 0, 0);
export const ip4str = (n: number): string => `${n >>> 24}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`;

function parseMac(s: string): Uint8Array {
	return Uint8Array.from(s.split(":").map((h) => parseInt(h, 16)));
}

// Internet checksum helpers.
function sum16(u8: Uint8Array, off: number, len: number, s = 0): number {
	const end = off + len;
	let i = off;
	for (; i + 1 < end; i += 2) s += (u8[i]! << 8) | u8[i + 1]!;
	if (i < end) s += u8[i]! << 8;
	return s;
}
function fold(s: number): number {
	while (s > 0xffff) s = (s & 0xffff) + Math.floor(s / 65536);
	return ~s & 0xffff;
}

const seqLt = (a: number, b: number) => ((a - b) | 0) < 0;
const seqLe = (a: number, b: number) => ((a - b) | 0) <= 0;
const seqAdd = (a: number, n: number) => (a + n) >>> 0;
const seqDiff = (a: number, b: number) => (a - b) | 0;

/** FIFO of bytes with random-access reads from the front. */
class ByteQueue {
	chunks: Uint8Array[] = [];
	/** Offset into chunks[0]. */
	head = 0;
	length = 0;
	push(u8: Uint8Array): void {
		if (!u8.length) return;
		this.chunks.push(u8);
		this.length += u8.length;
	}
	drop(n: number): void {
		this.length -= n;
		while (n > 0) {
			const c = this.chunks[0]!;
			const avail = c.length - this.head;
			if (n < avail) { this.head += n; return; }
			n -= avail;
			this.chunks.shift();
			this.head = 0;
		}
	}
	copyTo(dst: Uint8Array, dstOff: number, offset: number, len: number): void {
		let i = 0, pos = this.head + offset;
		while (pos >= this.chunks[i]!.length) pos -= this.chunks[i++]!.length;
		while (len > 0) {
			const c = this.chunks[i++]!;
			const take = Math.min(len, c.length - pos);
			dst.set(c.subarray(pos, pos + take), dstOff);
			dstOff += take;
			len -= take;
			pos = 0;
		}
	}
}

const RCVBUF = 256 * 1024;      // guest -> backend bytes we accept before closing the window
const SNDBUF_HIGH = 512 * 1024; // backend -> guest bytes queued before pausing the backend
const RTO_MS = 1000, RTO_MAX_MS = 8000, MAX_RETRIES = 8;

interface Segment {
	sport: number;
	dport: number;
	seq: number;
	ack: number;
	flags: number;
	win: number;
	mss?: number;
	wscale?: number;
}

/** What sendTcp needs of a connection (a TcpConn, or a stand-in for a reset). */
interface TcpEndpoint {
	ip: number;
	port: number;
	gport: number;
	rcvNxt: number;
	sndUna: number;
	sendq: ByteQueue | null;
}

class TcpConn implements TcpEndpoint {
	stack: NetStack;
	key: string;
	gport: number;
	ip: number;
	port: number;
	irs: number;
	rcvNxt: number;
	iss: number;
	sndUna: number;
	sndNxt: number;
	mss: number;
	sndWscale: number;
	rcvWscale: number;
	sndWl: number;
	sendq: ByteQueue;
	state: "connecting" | "synrcvd" | "established" | "closed";
	remoteEof: boolean;
	finSent: boolean;
	guestFin: boolean;
	paused: boolean;
	rto: number;
	retries: number;
	timer: ReturnType<typeof setTimeout> | null;
	lastWnd: number;
	handle: NetConnection | undefined;

	constructor(stack: NetStack, key: string, gport: number, ip: number, port: number, seg: Segment) {
		this.stack = stack;
		this.key = key;
		this.gport = gport;      // guest port
		this.ip = ip;            // remote (as seen by the guest)
		this.port = port;
		this.irs = seg.seq;
		this.rcvNxt = seqAdd(seg.seq, 1);
		this.iss = (Math.random() * 0x100000000) >>> 0;
		this.sndUna = this.iss;
		this.sndNxt = this.iss;  // SYN not sent yet
		this.mss = seg.mss ?? 536;
		this.sndWscale = seg.wscale ?? 0;
		this.rcvWscale = seg.wscale !== undefined ? 4 : 0;
		this.sndWl = seqAdd(this.iss + 1, seg.win); // right edge of the guest's window
		this.sendq = new ByteQueue();  // from sndUna: in flight, then unsent
		this.state = "connecting";     // -> "synrcvd" -> "established" -> "closed"
		this.remoteEof = false;        // backend ended: send FIN after the data
		this.finSent = false;
		this.guestFin = false;
		this.paused = false;
		this.rto = RTO_MS;
		this.retries = 0;
		this.timer = null;
		this.lastWnd = 0;
		this.handle = undefined;
	}

	inFlight(): number { return seqDiff(this.sndNxt, this.sndUna) - (this.finSent ? 1 : 0); }

	rcvWnd(): number {
		const free = Math.max(0, RCVBUF - (this.handle?.buffered ?? 0));
		return Math.min(free >> this.rcvWscale, 0xffff);
	}

	send(flags: number, seq: number, payloadLen = 0, opts: Uint8Array | null = null): void {
		const wnd = this.rcvWnd();
		this.lastWnd = wnd << this.rcvWscale;
		this.stack.sendTcp(this, flags, seq, payloadLen, opts, wnd);
	}

	ack(): void { this.send(ACK, this.sndNxt); }

	synAck(): void {
		const o = [2, 4, 0x05, 0xb4]; // MSS 1460 (TSO frames from the guest may be larger)
		if (this.sndWscale || this.rcvWscale) o.push(1, 3, 3, this.rcvWscale);
		this.send(SYN | ACK, this.iss, 0, Uint8Array.from(o));
		this.sndNxt = seqAdd(this.iss, 1);
		this.armTimer();
	}

	/** Send whatever the guest's window allows, then FIN if due. */
	flush(): void {
		if (this.state !== "established") return;
		let sent = false;
		for (;;) {
			const off = seqDiff(this.sndNxt, this.sndUna);
			const unsent = this.sendq.length - off;
			const room = seqDiff(this.sndWl, this.sndNxt);
			if (unsent <= 0 || room <= 0) break;
			const n = Math.min(unsent, room, this.mss);
			this.send(ACK | PSH, this.sndNxt, n);
			this.sndNxt = seqAdd(this.sndNxt, n);
			sent = true;
		}
		if (this.remoteEof && !this.finSent && seqDiff(this.sndNxt, this.sndUna) === this.sendq.length) {
			this.send(FIN | ACK, this.sndNxt);
			this.sndNxt = seqAdd(this.sndNxt, 1);
			this.finSent = true;
			sent = true;
		}
		if (sent || (this.sendq.length && seqDiff(this.sndWl, this.sndNxt) <= 0)) this.armTimer();
		if (this.paused && this.sendq.length < SNDBUF_HIGH / 2) {
			this.paused = false;
			this.handle?.resume();
		}
	}

	armTimer(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => this.onTimer(), this.rto);
	}

	clearTimer(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
	}

	onTimer(): void {
		this.timer = null;
		if (this.state === "closed") return;
		if (++this.retries > MAX_RETRIES) {
			this.stack.log?.(`[net] tcp ${ip4str(this.ip)}:${this.port}: guest unresponsive, resetting`);
			this.send(RST | ACK, this.sndNxt);
			this.close();
			return;
		}
		this.rto = Math.min(this.rto * 2, RTO_MAX_MS);
		if (this.state === "synrcvd") {
			this.sndNxt = this.iss;
			this.synAck();
		} else if (seqDiff(this.sndNxt, this.sndUna) > 0) {
			// Go back N (the link is lossless; this only happens when the guest
			// dropped frames, e.g. under memory pressure).
			this.sndNxt = this.sndUna;
			this.finSent = false;
			this.flush();
		} else if (this.sendq.length) {
			// Zero window probe: an out-of-window segment makes the guest ACK.
			this.send(ACK, seqAdd(this.sndUna, -1));
			this.armTimer();
		}
	}

	connect(): void {
		const host = this.stack.backendHost(this.ip);
		if (host === null) return this.refuse();
		this.handle = this.stack.backend.connect({ host, port: this.port }, {
			onConnect: () => {
				if (this.state !== "connecting") return;
				this.state = "synrcvd";
				this.synAck();
			},
			onData: (u8) => {
				if (this.state === "closed") return;
				this.sendq.push(u8);
				if (!this.paused && this.sendq.length >= SNDBUF_HIGH) {
					this.paused = true;
					this.handle!.pause();
				}
				this.flush();
			},
			onEnd: () => {
				if (this.state === "closed") return;
				this.remoteEof = true;
				this.flush();
			},
			onDrain: () => {
				if (this.state === "established" && this.lastWnd < RCVBUF / 2) this.ack();
			},
			onClose: (err) => {
				if (this.state === "closed") return;
				if (this.state === "connecting") return this.refuse(err);
				if (err) {
					this.stack.log?.(`[net] tcp ${ip4str(this.ip)}:${this.port}: ${err.message ?? err}`);
					this.send(RST | ACK, this.sndNxt);
					this.close();
				} else {
					this.remoteEof = true;
					this.flush();
				}
			},
		});
	}

	refuse(err?: Error | null): void {
		if (err) this.stack.log?.(`[net] tcp connect ${ip4str(this.ip)}:${this.port}: ${err.message ?? err}`);
		this.stack.sendTcp(this, RST | ACK, 0, 0, null, 0);
		this.close();
	}

	close(): void {
		if (this.state === "closed") return;
		this.state = "closed";
		this.clearTimer();
		this.stack.tcp.delete(this.key);
		this.handle?.destroy();
	}

	maybeDone(): void {
		if (this.guestFin && this.finSent && this.sndUna === this.sndNxt) this.close();
	}

	/** A segment from the guest for this connection. */
	input(seg: Segment, payload: Uint8Array): void {
		if (seg.flags & RST) return this.close();
		if (seg.flags & SYN) {
			// Retransmitted SYN: answer again once we have something to say.
			if (this.state === "synrcvd") { this.sndNxt = this.iss; this.clearTimer(); this.synAck(); }
			return;
		}
		if (!(seg.flags & ACK) || this.state === "connecting") return;

		// ACK processing.
		const ack = seg.ack;
		if (seqLt(this.sndUna, ack) && seqLe(ack, this.sndNxt)) {
			let n = seqDiff(ack, this.sndUna);
			if (this.state === "synrcvd") { this.state = "established"; n--; }
			if (this.finSent && ack === this.sndNxt) n--;
			if (n > 0) this.sendq.drop(n);
			this.sndUna = ack;
			this.retries = 0;
			this.rto = RTO_MS;
			this.clearTimer();
			if (this.sndUna !== this.sndNxt) this.armTimer();
		}
		if (this.state === "synrcvd") return;
		if (seqLe(this.sndUna, ack)) this.sndWl = seqAdd(ack, seg.win << this.sndWscale);
		if (this.sndUna === this.sndNxt) this.retries = 0; // answered a window probe

		// Data and FIN, in order only (anything else gets a duplicate ACK).
		const len = payload.length;
		let seq = seg.seq;
		let data = payload;
		let needAck = false;
		if (len || seg.flags & FIN) {
			const skip = seqDiff(this.rcvNxt, seq);
			if (skip > 0) {
				if (skip >= len + (seg.flags & FIN ? 1 : 0)) { this.ack(); return; }
				data = data.subarray(Math.min(skip, len));
				seq = this.rcvNxt;
			} else if (skip < 0) {
				this.ack();
				return;
			}
			if (data.length && !this.guestFin) {
				this.handle!.write(data);
				this.rcvNxt = seqAdd(this.rcvNxt, data.length);
			}
			if (seg.flags & FIN && !this.guestFin) {
				this.guestFin = true;
				this.rcvNxt = seqAdd(this.rcvNxt, 1);
				this.handle!.end();
			}
			needAck = true;
		}
		const before = this.sndNxt;
		this.flush();
		if (needAck && this.sndNxt === before) this.ack();
		this.maybeDone();
	}
}

/**
 * The host end of the guest's network: pass it as the kernel's `net`
 * (kwnet) device. Terminates the guest's frames and bridges TCP and DNS to
 * `opts.backend`.
 */
export class NetStack implements NetDevice {
	backend: NetBackend;
	log: ((msg: string) => void) | undefined;
	hostLoopback: boolean;
	mtu: number | undefined;
	/** The guest's MAC. */
	mac: Uint8Array;
	gwMac: Uint8Array;
	guestMac: Uint8Array;
	net: number;
	mask: number;
	gw: number;
	dns: number;
	guest: number;
	tcp: Map<string, TcpConn>;
	/** Relayed UDP flows by "sport/dst/dport", least recently used first. */
	udp: Map<string, UdpFlow>;
	udpTimer: ReturnType<typeof setInterval> | undefined;
	ipId: number;
	/** Where frames for the guest go (set by attach()). */
	output: (frame: Uint8Array) => void;
	stats: NetStats;

	constructor(opts: NetStackOptions) {
		this.backend = opts.backend;
		this.log = opts.log;
		this.hostLoopback = opts.hostLoopback ?? false;
		this.mtu = opts.mtu;
		this.mac = parseMac(opts.mac ?? "52:54:00:12:34:56");   // the guest's
		this.gwMac = parseMac("52:55:0a:00:02:02");
		this.guestMac = this.mac;
		this.net = ip4("10.0.2.0");
		this.mask = ip4("255.255.255.0");
		this.gw = ip4("10.0.2.2");
		this.dns = ip4("10.0.2.3");
		this.guest = ip4("10.0.2.15");
		this.tcp = new Map();
		this.udp = new Map();
		this.udpTimer = undefined;
		this.ipId = 1;
		this.output = () => {};
		this.stats = { rx: 0, tx: 0, tcpOpened: 0, dns: 0, udpOpened: 0 };
	}

	/** Hook up to a Kernel (core/kernel.ts); called when the guest's driver initialises. */
	attach(kernel: Kernel): void {
		this.output = (frame) => kernel.receiveFrame(frame);
	}

	/** Frame from the guest. */
	send(frame: Uint8Array): void {
		this.stats.rx++;
		try {
			this.input(frame);
		} catch (e) {
			this.log?.(`[net] dropped malformed frame: ${errorText(e)}`);
		}
	}

	/** Reset every TCP connection and drop every UDP flow (the backend stays usable). */
	close(): void {
		for (const c of [...this.tcp.values()]) c.close();
		for (const key of [...this.udp.keys()]) this.udpDrop(key);
	}

	emit(frame: Uint8Array): void {
		this.stats.tx++;
		this.output(frame);
	}

	backendHost(ip: number): string | null {
		if (ip === this.gw) return this.hostLoopback ? "127.0.0.1" : null;
		if (((ip & this.mask) >>> 0) === this.net) return null;
		if (ip === 0xffffffff || ip >>> 28 === 14 || ip >>> 24 === 0 || ip >>> 24 === 127) return null;
		return ip4str(ip);
	}

	input(f: Uint8Array): void {
		if (f.length < 14) return;
		const type = (f[12]! << 8) | f[13]!;
		if (type === ETH_ARP) this.arp(f);
		else if (type === ETH_IP) this.ipv4(f);
	}

	arp(f: Uint8Array): void {
		const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
		if (f.length < 42 || dv.getUint16(20) !== 1) return; // requests only
		const tip = dv.getUint32(38);
		const sip = dv.getUint32(28);
		if (tip === sip || tip === this.guest || ((tip & this.mask) >>> 0) !== this.net) return;
		this.guestMac = f.slice(22, 28);
		const r = new Uint8Array(42);
		r.set(this.guestMac, 0);
		r.set(this.gwMac, 6);
		const o = new DataView(r.buffer);
		o.setUint16(12, ETH_ARP);
		o.setUint16(14, 1); o.setUint16(16, ETH_IP); r[18] = 6; r[19] = 4; o.setUint16(20, 2);
		r.set(this.gwMac, 22); o.setUint32(28, tip);
		r.set(f.subarray(22, 28), 32); o.setUint32(38, sip);
		this.emit(r);
	}

	ipv4(f: Uint8Array): void {
		const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
		if (f.length < 34 || f[14]! >> 4 !== 4) return;
		const ihl = (f[14]! & 15) * 4;
		const total = dv.getUint16(16);
		if ((dv.getUint16(20) & 0x3fff) !== 0) return; // fragments: unsupported
		const proto = f[23];
		const src = dv.getUint32(26), dst = dv.getUint32(30);
		const l4 = 14 + ihl;
		const end = Math.min(f.length, total ? 14 + total : f.length);
		if (end < l4) return;
		this.guestMac = f.slice(6, 12);
		if (proto === PROTO_TCP) this.tcpInput(f, dv, src, dst, l4, end);
		else if (proto === PROTO_UDP) this.udpInput(f, dv, src, dst, l4, end);
		else if (proto === PROTO_ICMP) this.icmpInput(f, dv, src, dst, l4, end);
	}

	// --- frame builders -----------------------------------------------------

	/** Ethernet + IPv4 header for a reply to the guest; returns [frame, view]. */
	ipFrame(src: number, dst: number, proto: number, l4len: number, dstMac: Uint8Array = this.guestMac): [Uint8Array, DataView] {
		const f = new Uint8Array(34 + l4len);
		f.set(dstMac, 0);
		f.set(this.gwMac, 6);
		f[12] = 0x08; f[13] = 0x00;
		const dv = new DataView(f.buffer);
		f[14] = 0x45;
		dv.setUint16(16, 20 + l4len);
		dv.setUint16(18, this.ipId = (this.ipId + 1) & 0xffff);
		dv.setUint16(20, 0x4000); // DF
		f[22] = 64; f[23] = proto;
		dv.setUint32(26, src); dv.setUint32(30, dst);
		dv.setUint16(24, fold(sum16(f, 14, 20)));
		return [f, dv];
	}

	l4csum(f: Uint8Array, src: number, dst: number, proto: number, off: number, len: number): number {
		const s = (src >>> 16) + (src & 0xffff) + (dst >>> 16) + (dst & 0xffff) + proto + len;
		return fold(sum16(f, off, len, s));
	}

	sendUdp(src: number, sport: number, dst: number, dport: number, payload: Uint8Array, dstMac?: Uint8Array): void {
		const [f, dv] = this.ipFrame(src, dst, PROTO_UDP, 8 + payload.length, dstMac);
		dv.setUint16(34, sport); dv.setUint16(36, dport); dv.setUint16(38, 8 + payload.length);
		f.set(payload, 42);
		dv.setUint16(40, this.l4csum(f, src, dst, PROTO_UDP, 34, 8 + payload.length) || 0xffff);
		this.emit(f);
	}

	sendTcp(c: TcpEndpoint, flags: number, seq: number, payloadLen: number, opts: Uint8Array | null, wnd: number): void {
		const olen = opts ? opts.length : 0;
		const hl = 20 + olen;
		const [f, dv] = this.ipFrame(c.ip, this.guest, PROTO_TCP, hl + payloadLen);
		dv.setUint16(34, c.port); dv.setUint16(36, c.gport);
		dv.setUint32(38, seq); dv.setUint32(42, flags & ACK ? c.rcvNxt : 0);
		f[46] = (hl / 4) << 4; f[47] = flags;
		dv.setUint16(48, wnd);
		if (opts) f.set(opts, 54);
		if (payloadLen) c.sendq!.copyTo(f, 34 + hl, seqDiff(seq, c.sndUna), payloadLen);
		dv.setUint16(50, this.l4csum(f, c.ip, this.guest, PROTO_TCP, 34, hl + payloadLen));
		this.emit(f);
	}

	// --- ICMP ------------------------------------------------------------------

	icmpInput(f: Uint8Array, _dv: DataView, src: number, dst: number, l4: number, end: number): void {
		if (f[l4] !== 8 || (dst !== this.gw && dst !== this.dns)) return; // echo request
		const len = end - l4;
		const [r, rv] = this.ipFrame(dst, src, PROTO_ICMP, len);
		r.set(f.subarray(l4, end), 34);
		r[34] = 0; rv.setUint16(36, 0);
		rv.setUint16(36, fold(sum16(r, 34, len)));
		this.emit(r);
	}

	icmpUnreachable(f: Uint8Array, l4: number, src: number, dst: number, code: number): void {
		const quote = f.subarray(14, Math.min(f.length, l4 + 8));
		const [r, rv] = this.ipFrame(dst, src, PROTO_ICMP, 8 + quote.length);
		r[34] = 3; r[35] = code;
		r.set(quote, 42);
		rv.setUint16(36, fold(sum16(r, 34, 8 + quote.length)));
		this.emit(r);
	}

	// --- UDP: DHCP, DNS and flows relayed by the backend ---------------------------

	udpInput(f: Uint8Array, dv: DataView, src: number, dst: number, l4: number, end: number): void {
		if (end - l4 < 8) return;
		const sport = dv.getUint16(l4), dport = dv.getUint16(l4 + 2);
		const payload = f.subarray(l4 + 8, Math.min(end, l4 + dv.getUint16(l4 + 4)));
		if (dport === 67) return this.dhcp(payload);
		if (dport === 53 && (dst === this.dns || dst === this.gw)) {
			void this.dnsQuery(payload, src, sport, dst);
			return;
		}
		if (dst === 0xffffffff || dst >>> 28 === 14) return;
		const host = this.backend.udp ? this.backendHost(dst) : null;
		if (host === null || dport === 0) return this.icmpUnreachable(f, l4, src, dst, 3);
		const key = `${sport}/${dst}/${dport}`;
		let u = this.udp.get(key);
		if (u) this.udp.delete(key); // back in below, as the most recently used
		else {
			let flow: NetDatagramFlow;
			const me: { u?: UdpFlow } = {};
			const mine = () => me.u !== undefined && this.udp.get(key) === me.u;
			try {
				flow = this.backend.udp!({ host, port: dport }, {
					onMessage: (data) => {
						// No IP fragments: a datagram larger than the guest's MTU is dropped.
						if (!mine() || data.length > (this.mtu ?? 1500) - 28) return;
						me.u!.replied = true;
						me.u!.last = performance.now();
						this.sendUdp(dst, dport, src, sport, data);
					},
					onClose: (err) => {
						if (!mine()) return;
						const { quote, l4, replied } = me.u!;
						this.udp.delete(key);
						// A flow the backend refused (no UDP on this server, a blocked or dead port).
						if (err && !replied) {
							this.log?.(`[net] udp ${ip4str(dst)}:${dport}: ${err.message}`);
							this.icmpUnreachable(quote, l4, src, dst, 3);
						}
					},
				});
			} catch (e) {
				this.log?.(`[net] udp ${ip4str(dst)}:${dport}: ${errorText(e)}`);
				return this.icmpUnreachable(f, l4, src, dst, 3);
			}
			u = me.u = { flow, last: 0, replied: false, quote: f, l4 };
			this.stats.udpOpened++;
			if (this.udp.size >= UDP_MAX_FLOWS) this.udpDrop(this.udp.keys().next().value!);
			this.udpTimer ??= unref(setInterval(() => this.udpSweep(), 5000));
		}
		u.last = performance.now();
		u.quote = f.slice(0, l4 + 8);
		u.l4 = l4;
		this.udp.set(key, u);
		u.flow.send(payload.slice());
	}

	udpDrop(key: string): void {
		const u = this.udp.get(key);
		if (!u) return;
		this.udp.delete(key);
		try { u.flow.close(); } catch { /* the transport is gone */ }
	}

	udpSweep(): void {
		const now = performance.now();
		for (const [key, u] of this.udp) if (now - u.last > (u.replied ? UDP_IDLE_MS : UDP_UNANSWERED_MS)) this.udpDrop(key);
		if (this.udp.size === 0) { clearInterval(this.udpTimer); this.udpTimer = undefined; }
	}

	dhcp(p: Uint8Array): void {
		if (p.length < 240 || p[0] !== 1) return;
		const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
		if (dv.getUint32(236) !== 0x63825363) return;
		let type = 0;
		for (let i = 240; i < p.length && p[i] !== 255;) {
			if (p[i] === 0) { i++; continue; }
			if (p[i] === 53) type = p[i + 2]!;
			i += 2 + p[i + 1]!;
		}
		const reply = ({ 1: 2, 3: 5, 8: 5 } as Record<number, number>)[type]; // DISCOVER->OFFER, REQUEST->ACK, INFORM->ACK
		if (!reply) return;
		const opts = [53, 1, reply, 54, 4, ...this.bytes4(this.gw)];
		if (type !== 8) opts.push(51, 4, ...this.bytes4(86400));
		opts.push(1, 4, ...this.bytes4(this.mask), 3, 4, ...this.bytes4(this.gw),
			6, 4, ...this.bytes4(this.dns), 28, 4, ...this.bytes4((this.net | ~this.mask) >>> 0));
		if (this.mtu) opts.push(26, 2, this.mtu >> 8, this.mtu & 255);
		opts.push(255);
		const r = new Uint8Array(240 + opts.length);
		const rv = new DataView(r.buffer);
		r[0] = 2; r[1] = 1; r[2] = 6;
		r.set(p.subarray(4, 8), 4);       // xid
		r.set(p.subarray(10, 12), 10);    // flags
		r.set(p.subarray(12, 16), 12);    // ciaddr
		if (type !== 8) rv.setUint32(16, this.guest); // yiaddr
		rv.setUint32(20, this.gw);        // siaddr
		r.set(p.subarray(28, 44), 28);    // chaddr
		rv.setUint32(236, 0x63825363);
		r.set(opts, 240);
		const chaddr = p.slice(28, 34);
		this.sendUdp(this.gw, 67, 0xffffffff, 68, r, Uint8Array.of(255, 255, 255, 255, 255, 255));
		if (reply === 5) this.guestMac = chaddr;
	}

	bytes4(n: number): number[] { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }

	async dnsQuery(q: Uint8Array, src: number, sport: number, dst: number): Promise<void> {
		if (q.length < 12) return;
		const dv = new DataView(q.buffer, q.byteOffset, q.byteLength);
		if (q[2]! & 0x80 || dv.getUint16(4) !== 1) return; // one question, queries only
		const labels: string[] = [];
		let i = 12;
		while (i < q.length && q[i] !== 0) {
			if (q[i]! & 0xc0) return;
			labels.push(new TextDecoder().decode(q.subarray(i + 1, i + 1 + q[i]!)));
			i += 1 + q[i]!;
		}
		if (i + 5 > q.length) return;
		const qtype = dv.getUint16(i + 1), qclass = dv.getUint16(i + 3);
		const qend = i + 5;
		const name = labels.join(".");
		this.stats.dns++;
		let rcode = 0, addrs: string[] = [];
		if (qtype === 1 && qclass === 1) {
			try {
				addrs = await this.backend.lookup(name);
				addrs = addrs.filter((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
				if (!addrs.length) rcode = 3;
			} catch (e) {
				const err = e as { code?: string; message?: string };
				rcode = err?.code === "ENOTFOUND" || err?.code === "ENODATA" ? 3 : 2;
				if (rcode === 2) this.log?.(`[net] dns ${name}: ${err?.message ?? e}`);
			}
		}
		// Other types (AAAA, ...): NOERROR without answers.
		const r = new Uint8Array(qend + addrs.length * 16);
		r.set(q.subarray(0, qend));
		const rv = new DataView(r.buffer);
		rv.setUint16(2, 0x8000 | (q[2]! & 1) << 8 | 0x80 | rcode); // QR, RD copied, RA
		rv.setUint16(6, addrs.length); rv.setUint16(8, 0); rv.setUint16(10, 0);
		let o = qend;
		for (const a of addrs) {
			rv.setUint16(o, 0xc00c); rv.setUint16(o + 2, 1); rv.setUint16(o + 4, 1);
			rv.setUint32(o + 6, 60); rv.setUint16(o + 10, 4); rv.setUint32(o + 12, ip4(a));
			o += 16;
		}
		this.sendUdp(dst, 53, src, sport, r);
	}

	// --- TCP ---------------------------------------------------------------------

	tcpInput(f: Uint8Array, dv: DataView, _src: number, dst: number, l4: number, end: number): void {
		if (end - l4 < 20) return;
		const hl = (f[l4 + 12]! >> 4) * 4;
		const seg: Segment = {
			sport: dv.getUint16(l4), dport: dv.getUint16(l4 + 2),
			seq: dv.getUint32(l4 + 4), ack: dv.getUint32(l4 + 8),
			flags: f[l4 + 13]!, win: dv.getUint16(l4 + 14),
		};
		const payload = f.subarray(l4 + hl, end);
		const key = `${seg.sport}/${dst}/${seg.dport}`;
		let c = this.tcp.get(key);
		if ((seg.flags & (SYN | ACK)) === SYN) {
			if (c && c.irs === seg.seq) return c.input(seg, payload);
			c?.close();
			for (let i = l4 + 20; i < l4 + hl;) {
				const kind = f[i];
				if (kind === 0) break;
				if (kind === 1) { i++; continue; }
				if (kind === 2) seg.mss = dv.getUint16(i + 2);
				if (kind === 3) seg.wscale = Math.min(f[i + 2]!, 14);
				i += Math.max(2, f[i + 1]!);
			}
			c = new TcpConn(this, key, seg.sport, dst, seg.dport, seg);
			this.tcp.set(key, c);
			this.stats.tcpOpened++;
			c.connect();
			return;
		}
		if (c) return c.input(seg, payload);
		if (seg.flags & RST) return;
		// No such connection: reset.
		const fake: TcpEndpoint = { ip: dst, port: seg.dport, gport: seg.sport, rcvNxt: 0, sndUna: 0, sendq: null };
		if (seg.flags & ACK) {
			this.sendTcp(fake, RST, seg.ack, 0, null, 0);
		} else {
			fake.rcvNxt = seqAdd(seg.seq, payload.length + (seg.flags & FIN ? 1 : 0));
			this.sendTcp(fake, RST | ACK, 0, 0, null, 0);
		}
	}
}
