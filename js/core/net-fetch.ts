// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// NetStack backend wrapper that answers plain-HTTP connections to chosen
// host names with the host's fetch() instead of the inner backend: a
// minimal HTTP/1.1 server per connection (GET and HEAD, keep-alive with
// pipelining, answered strictly in order). Everything else goes to the
// inner backend.
//
//   fetchRoutes(inner, { "example.org": "https://cors.example/base" })
//
// A routed name resolves to a reserved address of 198.51.100.0/24
// (TEST-NET-2: outside Wisp's 198.18.0.0/15 and the guest's 10.0.2.0/24,
// and passed through by NetStack.backendHost()). A connection to it on port
// 80 is served here; on another port it is refused.
//
// A string route rewrites the URL's prefix (http://HOST/path?q becomes
// BASE/path?q) and forwards only the headers in FORWARD_HEADERS; a
// function route gets a Request with the guest's headers.

import type { NetBackend, NetConnection, NetConnectionEvents } from "./net.ts";

/** A base URL (prefix rewrite) or a handler. */
export type FetchRoute = string | ((req: Request) => Response | Promise<Response>);

export interface FetchRoutesOptions {
	log?: (msg: string) => void;
}

/** close() aborts every served request and closes the inner backend. */
export interface FetchRoutesBackend extends NetBackend {
	close(): void;
}

/** Request headers a string route forwards (in a browser the target's CORS must allow them). */
const FORWARD_HEADERS = ["range", "if-range", "if-modified-since", "if-none-match"];
/** Response headers copied into the answer (besides the length and framing). */
const COPY_HEADERS = ["Content-Range", "ETag", "Last-Modified", "Accept-Ranges", "Content-Type"];
/** Guest headers not passed to a function route. */
const HOP_HEADERS = new Set(["host", "connection", "keep-alive", "transfer-encoding", "content-length", "upgrade", "proxy-connection", "te"]);

const ROUTE_BASE = (198 << 24 | 51 << 16 | 100 << 8) >>> 0;
const MAX_ROUTES = 254;
const MAX_HEAD = 16 * 1024;
const REASONS: Record<number, string> = {
	200: "OK", 204: "No Content", 206: "Partial Content", 301: "Moved Permanently", 302: "Found", 304: "Not Modified",
	400: "Bad Request", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 416: "Range Not Satisfiable",
	431: "Request Header Fields Too Large", 500: "Internal Server Error", 502: "Bad Gateway", 503: "Service Unavailable",
};

const enc = new TextEncoder();
const latin1 = new TextDecoder("latin1");
const ipStr = (ip: number) => `${ip >>> 24}.${(ip >>> 16) & 255}.${(ip >>> 8) & 255}.${ip & 255}`;
const normName = (s: string) => s.toLowerCase().replace(/\.$/, "");

interface Req {
	method: string;
	path: string;
	headers: [string, string][];
	/** Close the connection after this answer. */
	close: boolean;
	/** Answer this status without fetching (a bad request). */
	status?: number;
}

/** A refused connection: onClose with an error, asynchronously. */
function refused(ev: NetConnectionEvents, why: string): NetConnection {
	let dead = false;
	queueMicrotask(() => { if (!dead) ev.onClose(new Error(why)); });
	return { write() {}, end() {}, destroy() { dead = true; }, pause() {}, resume() {}, buffered: 0 };
}

function parseHead(head: string): Req {
	const lines = head.split("\r\n");
	const [method = "", target = "", version = "", ...rest] = lines[0]!.split(" ");
	const bad = (status: number): Req => ({ method, path: "/", headers: [], close: true, status });
	if (rest.length || !/^HTTP\/1\.[01]$/.test(version)) return bad(400);
	const headers: [string, string][] = [];
	for (const l of lines.slice(1)) {
		const i = l.indexOf(":");
		if (i <= 0) return bad(400);
		headers.push([l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]);
	}
	const get = (n: string) => headers.find(([k]) => k === n)?.[1];
	const conn = get("connection") ?? "";
	const close = version === "HTTP/1.0" ? !/keep-alive/i.test(conn) : /\bclose\b/i.test(conn);
	if (method !== "GET" && method !== "HEAD") return bad(405);
	if (get("transfer-encoding") || Number(get("content-length") ?? 0) > 0) return bad(400);
	// Absolute form (a proxy request): keep the path.
	const path = /^https?:\/\//i.test(target) ? target.replace(/^https?:\/\/[^/]*/i, "") || "/" : target;
	if (!path.startsWith("/")) return bad(400);
	return { method, path, headers, close };
}

/**
 * Wrap `inner` (or nothing: other names do not resolve and other
 * connections are refused) so that plain HTTP to the host names of
 * `routes` is answered with fetch().
 */
export function fetchRoutes(inner: NetBackend | undefined, routes: Record<string, FetchRoute>, opts: FetchRoutesOptions = {}): FetchRoutesBackend {
	const log = opts.log;
	const byName = new Map<string, { name: string; ip: string; route: FetchRoute }>();
	const byIp = new Map<string, { name: string; ip: string; route: FetchRoute }>();
	for (const [name, route] of Object.entries(routes)) {
		if (byName.size >= MAX_ROUTES) throw new Error(`fetchRoutes: more than ${MAX_ROUTES} routes`);
		const r = { name: normName(name), ip: ipStr(ROUTE_BASE + byName.size + 1), route };
		byName.set(r.name, r);
		byIp.set(r.ip, r);
	}
	const conns = new Set<() => void>();

	function fetchFor(host: string, route: FetchRoute, req: Req, signal: AbortSignal): Promise<Response> {
		if (typeof route !== "string") {
			const headers = new Headers();
			for (const [k, v] of req.headers) if (!HOP_HEADERS.has(k)) headers.append(k, v);
			return Promise.resolve(route(new Request(`http://${host}${req.path}`, { method: req.method, headers, signal })));
		}
		const headers: [string, string][] = req.headers.filter(([k]) => FORWARD_HEADERS.includes(k));
		return fetch(route.replace(/\/+$/, "") + req.path, { method: req.method, headers, signal });
	}

	function serve(host: string, route: FetchRoute, ev: NetConnectionEvents): NetConnection {
		let text = "";                  // unparsed request bytes (latin1)
		const queue: Req[] = [];
		let guestEnded = false, closing = false, dead = false, running = false, scheduled = false;
		let paused = false, wake: (() => void) | null = null;
		let ctl: AbortController | null = null;

		const emit = (b: Uint8Array | string) => { if (!dead) ev.onData(typeof b === "string" ? enc.encode(b) : b); };
		const kill = () => {
			dead = true;
			conns.delete(abortAll);
			ctl?.abort();
			wake?.();
		};
		const finish = (err: Error | null) => {
			if (dead) return;
			kill();
			if (!err) ev.onEnd();
			ev.onClose(err);
		};
		const abortAll = () => finish(new Error("backend closed"));
		conns.add(abortAll);
		queueMicrotask(() => { if (!dead) ev.onConnect(); });

		function parse(): void {
			while (!closing) {
				text = text.replace(/^(\r\n)+/, "");
				const i = text.indexOf("\r\n\r\n");
				if (i < 0) {
					if (text.length > MAX_HEAD) { queue.push({ method: "GET", path: "/", headers: [], close: true, status: 431 }); closing = true; }
					break;
				}
				const req = parseHead(text.slice(0, i));
				text = text.slice(i + 4);
				queue.push(req);
				if (req.close) closing = true;
			}
			if (closing) text = "";
		}

		function schedule(): void {
			if (scheduled || running) return;
			scheduled = true;
			queueMicrotask(() => { scheduled = false; void run(); });
		}

		async function run(): Promise<void> {
			if (running || dead) return;
			running = true;
			try {
				while (!dead && queue.length) await answer(queue.shift()!);
			} finally {
				running = false;
			}
			if (!dead && !queue.length && (closing || guestEnded)) finish(null);
		}

		function simple(req: Req, status: number, body = `${status} ${REASONS[status] ?? ""}\n`): void {
			const b = enc.encode(body);
			emit(`HTTP/1.1 ${status} ${REASONS[status] ?? ""}\r\nContent-Type: text/plain\r\nContent-Length: ${b.length}\r\n` +
				`Connection: ${req.close ? "close" : "keep-alive"}\r\n\r\n`);
			if (req.method !== "HEAD") emit(b);
		}

		async function answer(req: Req): Promise<void> {
			if (req.status) return simple(req, req.status);
			const c = (ctl = new AbortController());
			let res: Response;
			try {
				res = await fetchFor(host, route, req, c.signal);
			} catch (e) {
				if (dead) return;
				const msg = (e as Error)?.message ?? String(e);
				log?.(`[net] fetch http://${host}${req.path}: ${msg}`);
				return simple(req, 503, `fetch failed: ${msg}\n`);
			}
			if (dead) { res.body?.cancel().catch(() => {}); return; }
			const status = res.status;
			const len = res.headers.get("content-length"), coding = res.headers.get("content-encoding");
			const noBody = req.method === "HEAD" || status === 204 || status === 304 || status < 200;
			const chunked = !noBody && (len === null || coding !== null);
			let head = `HTTP/1.1 ${status} ${res.statusText || REASONS[status] || ""}\r\n`;
			if (len !== null && coding === null && status !== 204 && status !== 304) head += `Content-Length: ${len}\r\n`;
			else if (chunked) head += "Transfer-Encoding: chunked\r\n";
			for (const h of COPY_HEADERS) {
				const v = res.headers.get(h);
				if (v !== null) head += `${h}: ${v}\r\n`;
			}
			head += `Connection: ${req.close ? "close" : "keep-alive"}\r\n\r\n`;
			emit(head);
			if (noBody || !res.body) {
				res.body?.cancel().catch(() => {});
				if (chunked) emit("0\r\n\r\n");
				return;
			}
			const reader = res.body.getReader();
			try {
				for (;;) {
					while (paused && !dead) await new Promise<void>((r) => { wake = r; });
					if (dead) break;
					const { done, value } = await reader.read();
					if (dead || done) break;
					if (!value.length) continue;
					if (!chunked) { emit(value); continue; }
					const pre = enc.encode(`${value.length.toString(16)}\r\n`);
					const b = new Uint8Array(pre.length + value.length + 2);
					b.set(pre); b.set(value, pre.length); b[b.length - 2] = 13; b[b.length - 1] = 10;
					emit(b);
				}
				if (!dead && chunked) emit("0\r\n\r\n");
			} catch (e) {
				if (dead) return;
				log?.(`[net] fetch http://${host}${req.path}: ${(e as Error)?.message ?? e}`);
				finish(e instanceof Error ? e : new Error(String(e)));
			} finally {
				if (dead) reader.cancel().catch(() => {});
				if (ctl === c) ctl = null;
			}
		}

		return {
			write(u8) {
				if (dead || closing) return;
				text += latin1.decode(u8);
				parse();
				schedule();
			},
			end() {
				if (dead) return;
				guestEnded = true;
				schedule();
			},
			destroy() { if (!dead) kill(); },
			pause() { paused = true; },
			resume() {
				paused = false;
				const w = wake;
				wake = null;
				w?.();
			},
			buffered: 0,
		};
	}

	return {
		lookup(name) {
			const r = byName.get(normName(name));
			if (r) return Promise.resolve([r.ip]);
			return inner ? inner.lookup(name) : Promise.reject({ code: "ENOTFOUND" });
		},
		connect(addr, ev) {
			const r = byIp.get(addr.host) ?? byName.get(normName(addr.host));
			if (r) return addr.port === 80 ? serve(r.name, r.route, ev) : refused(ev, `connection refused (${r.name} serves port 80 only)`);
			return inner ? inner.connect(addr, ev) : refused(ev, "connection refused");
		},
		...(inner?.udp ? {
			udp(addr, ev) {
				if (byIp.has(addr.host)) throw new Error("no UDP on a routed address");
				return inner.udp!(addr, ev);
			},
		} satisfies Pick<NetBackend, "udp"> : {}),
		close() {
			for (const abort of [...conns]) abort();
			inner?.close?.();
		},
	};
}
