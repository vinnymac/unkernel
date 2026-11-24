// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// The unkernel page: Vite for the client (index.html, src/: React and
// Tailwind), Nitro for the build output (.output/ with the Node preset,
// `node .output/server/index.mjs`; .vercel/output/ on Vercel) and the
// response headers. The page is static: it runs the base bundle
// unkernel.wasm (its UP and SMP kernels, hashed assets in a build) with a
// read-only distro image read by URL, both from virtual:unkernel-kernel,
// which scripts/kernel.ts pageSource() picks before anything else. The
// page's service worker (the guest preview's relay) is public/vm-sw.js, the
// preview's server fallback server/vm.ts.
//
// Build settings (environment variables, scripts/kernel.ts): KW_KERNEL and
// KW_DISTROS give the base bundle and the images; else a local build
// (vendor/build) when there is one and it may be used (not where CI or
// VERCEL is set, unless KW_LOCAL=1; KW_LOCAL=0 never); else the newest
// GitHub release (KW_KERNEL_RELEASE=<tag>: that one), downloaded into
// web/kernel/release/; GITHUB_TOKEN for the API.
//
// The guest GL renderer (virgl.mjs and virgl.wasm, scripts/kernel.ts; only
// with the page's GL option are they fetched): the dev server answers
// /_gl/<file> itself (serveGl()); a build emits both into
// /assets/virgl-<sha256 prefix>/ (virgl.mjs finds virgl.wasm next to itself).
// The guest Vulkan renderer's translator (kwvk-naga.wasm, only with the
// page's Vulkan option, on the guest's first Vulkan instance) the same way:
// /_vk/kwvk-naga.wasm in dev (serveGl()), /assets/kwvk-naga-<sha256
// prefix>.wasm in a build.
//
// The images: the dev server answers /distros/<name>.erofs itself
// (serveDistros(), revalidated: a local image is rebuilt in place); a build
// names them /distros/<name>-<sha256 prefix>.erofs and copies them into the
// output after Nitro has built and compressed it (unkernel:distro-images),
// where the Node server answers them (server/distros.ts) and Vercel's CDN
// serves them as static files, immutable either way.
//
// A local wland build (.agents/web.md, Wayland desktop): KW_WLAND_PKG=<dir>
// (a copy of a wland checkout's package.json, LICENSE, README.md and dist/)
// makes a build import `wland` and its subpaths from there instead of
// node_modules (unkernel:wland-pkg), into .wland-local/output/ (Nitro's
// build directory .wland-local/build/), so web/.output, node_modules and a
// running dev server are left alone. Build only: a dev server still takes
// wland from node_modules.
//
// /licenses.md: the repository's THIRD-PARTY.md, then each package the
// page's bundle carries with its license text (unkernel:licenses). The dev
// server answers it with THIRD-PARTY.md alone.
//
// Runtime settings (environment variables of the built Node server):
//   PORT, HOST (NITRO_PORT, NITRO_HOST)  where it listens (default: port 3000, all interfaces)
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { copyFile, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { nitro } from "nitro/vite";
import { GL_FILES, VK_FILE, baseSplit, pageSource, rescanImages, servedName, splitBase, type PageImage } from "./scripts/kernel.ts";
import { IMMUTABLE, distroReply } from "./server/range.ts";

const require = createRequire(import.meta.url);

const git = (...args: string[]) => {
	try { return execFileSync("git", args, { cwd: import.meta.dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
	catch { return ""; }
};

/**
 * __KW_BUILD__ (src/env.d.ts), shown in the About dialog: the Linux release
 * from the base bundle's banner, the kernel's release tag ("local" for a
 * local build) and the page's commit. Empty where unknown (no git).
 */
async function buildInfo(dev: boolean) {
	const s = await pageSource(dev);
	const [commit = "", date = ""] = git("log", "-1", "--format=%H %cI").split(" ");
	return {
		linux: s.linux,
		kernel: s.kernel.tag,
		commit: commit || process.env.VERCEL_GIT_COMMIT_SHA || "",
		date,
	};
}

/** Where Vite lists the client's bundled packages (build.license), replaced by licenses.md. */
const BUNDLED_LICENSES = ".vite/license.json";

/** A package in Vite's build.license list. */
type BundledPackage = { name: string; version: string; identifier?: string; text?: string };

/**
 * Packages the page carries that Vite's list misses: it follows the JS
 * module graph, and src/style.css's @import of the fonts is not in it.
 */
const CSS_PACKAGES = ["@fontsource-variable/geist", "@fontsource-variable/geist-mono"];

/**
 * /licenses.md: THIRD-PARTY.md (its relative links made links into the
 * repository), then `bundled` and CSS_PACKAGES, each with its license text.
 */
function licenses(bundled: BundledPackage[]): string {
	const repo = "https://github.com/pithings/unkernel/blob/main/"; // src/config.ts REPO
	const notice = readFileSync(path.join(import.meta.dirname, "../THIRD-PARTY.md"), "utf8")
		.replace(/^<!--.*-->\n/gm, "")
		.replace(/\]\((?![a-z]+:)([^)]+)\)/g, (_, p: string) => `](${repo}${p})`);
	if (!bundled.length) return notice; // the dev server
	const all = new Map(bundled.map((p) => [p.name, p]));
	for (const name of CSS_PACKAGES) {
		if (all.has(name)) continue;
		const dir = path.dirname(require.resolve(`${name}/package.json`));
		const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { version: string; license?: string };
		const file = ["LICENSE", "LICENSE.md", "OFL.txt"].map((f) => path.join(dir, f)).find((f) => existsSync(f));
		if (!file) throw new Error(`[licenses] ${name} has no license file`);
		all.set(name, { name, version: pkg.version, identifier: pkg.license, text: readFileSync(file, "utf8").trim() });
	}
	const packages = [...all.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) =>
		`### ${p.name} ${p.version}${p.identifier ? ` (${p.identifier})` : ""}\n\n${p.text ? `\`\`\`\n${p.text.replaceAll("```", "'''")}\n\`\`\`` : "No license text in the package."}\n`);
	return `${notice}\n## The page's packages\n\n${packages.join("\n")}`;
}

/** The build output's directories and preset (Nitro's), known once Nitro has compiled. */
let output: { dir: string; publicDir: string; preset: string } | undefined;

/** The dev server's images as they are now (sizes and hashes read again: an image may have been rebuilt). */
let devImages: Promise<PageImage[]> | undefined;

/** KW_WLAND_PKG: a local wland package for a build, and where that build goes. */
const wlandPkg = process.env.KW_WLAND_PKG ? path.resolve(import.meta.dirname, process.env.KW_WLAND_PKG) : undefined;
const wlandLocal = path.join(import.meta.dirname, ".wland-local");

/**
 * `wland` and `wland/<sub>` (with any ?query) to the files the local
 * package's exports name. Build only, before Vite's own resolution.
 */
function wlandPkgPlugin(dir: string): Plugin {
	const exports = (JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { exports: Record<string, string> }).exports;
	// Nitro always points node_modules/.nitro/last-build.json at the newest
	// output (for `nitro preview`): put back what it said before.
	const lastBuild = path.join(import.meta.dirname, "node_modules/.nitro/last-build.json");
	let before: string | undefined;
	try { before = readFileSync(lastBuild, "utf8"); } catch {}
	process.once("exit", () => {
		try { if (before === undefined) rmSync(lastBuild, { force: true }); else writeFileSync(lastBuild, before); } catch {}
	});
	return {
		name: "unkernel:wland-pkg",
		apply: "build",
		enforce: "pre",
		configResolved() { console.log(`[wland] from ${dir} (KW_WLAND_PKG), output in ${path.relative(process.cwd(), wlandLocal)}/output`); },
		resolveId(id) {
			const m = /^wland(\/[^?]*)?(\?.*)?$/.exec(id);
			if (!m) return null;
			const target = exports[`.${m[1] ?? ""}`];
			if (!target) throw new Error(`[wland] ${dir}/package.json exports no ${id}`);
			return path.join(dir, target) + (m[2] ?? "");
		},
	};
}

export default defineConfig({
	// Every interface, so a phone on the LAN can open http://<this-machine>:8080/.
	server: {
		host: true,
		port: 8080,
		// The dev server's own responses (modules, /@fs/) do not go through
		// Nitro's route rules below. A worker script must carry COEP itself,
		// or a cross-origin isolated page refuses to start it (?worker=1).
		headers: { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp" },
		// A page build's output (its index.html) and the kernel files: a change
		// there must not reload an open dev page, which would end its VM.
		watch: { ignored: ["**/.output/**", "**/.vercel/**", "**/kernel/release/**", "**/kernel/page/**"] },
	},
	build: { target: "esnext" },
	// profile.html: the defaults profiler (src/profile.ts), and smp-probe.html:
	// the SMP slowdown probe (src/smp-probe.ts), pages of their own. Nitro
	// builds the client environment from index.html alone (its renderer
	// template), so they are a second client environment, which it builds
	// into the same public directory.
	// The page's bundled packages, as JSON for unkernel:licenses (client only:
	// the pages' bundles are a part of it).
	environments: {
		client: { build: { license: { fileName: BUNDLED_LICENSES } } },
		pages: { consumer: "client", build: { rollupOptions: { input: { profile: path.join(import.meta.dirname, "profile.html"), "smp-probe": path.join(import.meta.dirname, "smp-probe.html") } } } },
	},
	// The SDK's worker mode (?worker=1): js/web/worker.ts starts a module worker.
	worker: { format: "es" },
	plugins: [
		{
			// The kernel and the images first: picked (and fetched) before the
			// build resolves them, and __KW_BUILD__ reads the base's banner.
			name: "unkernel:kernel",
			async config(_, { command }) {
				return { define: { __KW_BUILD__: JSON.stringify(await buildInfo(command === "serve")) } };
			},
			configureServer(server) {
				// /distros/<name>.erofs with Range support and as they are (erofs
				// compresses inside): Nitro's dev handler would answer public/ files
				// compressed and in full.
				server.middlewares.use(serveDistros);
				// /_gl/virgl.mjs and virgl.wasm as they are (Vite's transform would rewrite the module), and /_vk/kwvk-naga.wasm.
				server.middlewares.use(serveGl);
				// A new base bundle (kernel/build.sh base): split it again. A rebuilt
				// image (kernel/build.sh distro): the list is read again on the next
				// page load.
				void pageSource(true).then((s) => {
					const images = s.distros.map((d) => d.file);
					server.watcher.add([s.base, ...images]);
					const onFile = (file: string) => {
						if (file === s.base) {
							splitBase(file, true).catch((e: unknown) => console.error(`[kernel] ${(e as Error).message}`));
							invalidate();
						}
						if (images.includes(file)) {
							devImages = undefined;
							invalidate();
						}
					};
					const invalidate = () => {
						const mod = server.environments.client.moduleGraph.getModuleById("\0virtual:unkernel-kernel");
						if (mod) server.environments.client.moduleGraph.invalidateModule(mod);
					};
					server.watcher.on("change", onFile);
					server.watcher.on("add", onFile);
				});
			},
			// src/sdk.ts's kernelUrl and kernelSmpUrl (the base bundle's UP and SMP
			// kernels: /@fs/ files in dev, hashed assets in a build; the SMP one
			// null without an SMP patch), glUrl (virgl.mjs, or null without the
			// GL renderer) and vkShaderUrl (kwvk-naga.wasm, or null without it),
			// and src/config.ts's distros.
			resolveId(id) {
				return id === "virtual:unkernel-kernel" ? "\0virtual:unkernel-kernel" : null;
			},
			async load(id) {
				if (id !== "\0virtual:unkernel-kernel") return null;
				const dev = this.environment.mode === "dev";
				const s = await pageSource(dev);
				let up: string, smp: string;
				if (dev) {
					const files = await splitBase(s.base);
					up = `new URL(${JSON.stringify(`/@fs${files.up}`)}, import.meta.url)`;
					smp = files.smp ? `new URL(${JSON.stringify(`/@fs${files.smp}`)}, import.meta.url)` : "null";
				} else {
					const split = await baseSplit(s.base);
					const asset = (name: string, source: Uint8Array) =>
						`new URL(import.meta.ROLLUP_FILE_URL_${this.emitFile({ type: "asset", name, source })}, import.meta.url)`;
					up = asset("unkernel.wasm", split.up);
					smp = split.smp ? asset("unkernel-smp.wasm", split.smp) : "null";
				}
				let gl = "null";
				// Against the location, not import.meta.url, which Vite would turn into an /@fs/ path.
				if (s.gl && dev) gl = `new URL("/_gl/${GL_FILES[0]}", globalThis.location.href)`;
				else if (s.gl) {
					// Fixed names in a directory named by their content: virgl.mjs loads ./virgl.wasm.
					const dir = `assets/virgl-${s.gl.sha256.slice(0, 16)}`;
					const ref = this.emitFile({ type: "asset", fileName: `${dir}/${GL_FILES[0]}`, source: await readFile(s.gl.mjs) });
					this.emitFile({ type: "asset", fileName: `${dir}/${GL_FILES[1]}`, source: await readFile(s.gl.wasm) });
					gl = `new URL(import.meta.ROLLUP_FILE_URL_${ref}, import.meta.url)`;
				}
				let vk = "null";
				if (s.vk && dev) vk = `new URL("/_vk/${VK_FILE}", globalThis.location.href)`;
				else if (s.vk) {
					const ref = this.emitFile({ type: "asset", fileName: `assets/kwvk-naga-${s.vk.sha256.slice(0, 16)}.wasm`, source: await readFile(s.vk.wasm) });
					vk = `new URL(import.meta.ROLLUP_FILE_URL_${ref}, import.meta.url)`;
				}
				const images = dev ? await (devImages ??= rescanImages(s)) : s.distros;
				const distros = images.map(({ name, url, size, imageId }) => ({ name, url, size, ...(imageId ? { imageId } : {}) }));
				return [
					`export const kernelUrl = ${up};`,
					`export const kernelSmpUrl = ${smp};`,
					`export const glUrl = ${gl};`,
					`export const vkShaderUrl = ${vk};`,
					`export const distros = ${JSON.stringify(distros)};`,
				].join("\n");
			},
		},
		{
			// Files in public/ are answered by Nitro's dev handler, with neither
			// server.headers above nor the route rules below. Set the isolation
			// headers first, so a document there is
			// cross-origin isolated like the page.
			name: "unkernel:isolate-public",
			configureServer(server) {
				server.middlewares.use((_req, res, next) => {
					res.setHeader("cross-origin-opener-policy", "same-origin");
					res.setHeader("cross-origin-embedder-policy", "require-corp");
					next();
				});
			},
		},
		{
			// Nitro's dev renderer answers every page with index.html: profile.html
			// and smp-probe.html here (a build emits them as pages of their own,
			// build.rollupOptions above).
			name: "unkernel:profile-page",
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					const url = (req.url ?? "").split("?")[0]!;
					if (url !== "/profile.html" && url !== "/smp-probe.html") return next();
					readFile(path.join(import.meta.dirname, url.slice(1)), "utf8")
						.then((html) => server.transformIndexHtml(url, html))
						.then((html) => {
							res.setHeader("content-type", "text/html; charset=utf-8");
							res.end(html);
						}, next);
				});
			},
		},
		{
			// /licenses.md (licenses() below): the dev server's, and a build's
			// in place of Vite's JSON list of the client's bundled packages.
			name: "unkernel:licenses",
			configureServer(server) {
				server.middlewares.use((req, res, next) => {
					if ((req.url ?? "").split("?")[0] !== "/licenses.md") return next();
					res.setHeader("content-type", "text/markdown; charset=utf-8");
					res.setHeader("cache-control", "no-cache");
					res.end(licenses([]));
				});
			},
			generateBundle: {
				order: "post", // after vite:license
				handler(_, bundle) {
					if (this.environment.name !== "client") return;
					const list = bundle[BUNDLED_LICENSES];
					if (list?.type !== "asset") throw new Error(`[licenses] Vite gave no ${BUNDLED_LICENSES}`);
					delete bundle[BUNDLED_LICENSES];
					this.emitFile({ type: "asset", fileName: "licenses.md", source: licenses(JSON.parse(String(list.source)) as BundledPackage[]) });
				},
			},
		},
		...(wlandPkg ? [wlandPkgPlugin(wlandPkg)] : []),
		react(),
		tailwindcss(),
		nitro({
			...(wlandPkg ? { buildDir: path.join(wlandLocal, "build"), output: { dir: path.join(wlandLocal, "output") } } : {}),
			// The kernel (9 MiB) is sent br/zstd/gzip-encoded by the Node server.
			// Every file in the output's public directory is compressed (types
			// it does not know count as text), which is why the distro images
			// are copied in only afterwards (unkernel:distro-images).
			compressPublicAssets: true,
			// An earlier dev server's links to the images (web/public/distros/,
			// gitignored): never part of a build.
			ignore: ["public/distros/**"],
			handlers: [
				// The guest preview (src/preview.ts): /vm/** reaches the server only when the
				// service worker (public/vm-sw.js, served at /vm-sw.js) did not answer.
				{ route: "/vm/**", handler: "./server/vm.ts" },
				// The images on the Node server (the dev server answers them in
				// serveDistros() before Nitro sees them; Vercel's CDN serves them).
				{ route: "/distros/**", handler: "./server/distros.ts" },
			],
			hooks: {
				compiled(n) { output = { dir: n.options.output.dir, publicDir: n.options.output.publicDir, preset: n.options.preset }; },
			},
			routeRules: {
				// Cross-origin isolation (secure contexts only), so SharedArrayBuffer
				// is available. The kernel does not need it yet (its memory is not shared).
				"/**": {
					headers: {
						"cross-origin-opener-policy": "same-origin",
						"cross-origin-embedder-policy": "require-corp",
					},
				},
				// Checked for updates on every load (src/sw.ts); not cached by the CDN.
				"/vm-sw.js": { headers: { "cache-control": "no-cache" } },
				// The preview's WebSocket shim, which vm-sw.js puts into guest pages: in step with the worker.
				"/vm-ws.js": { headers: { "cache-control": "no-cache" } },
				// The preview's download helper, which vm-sw.js puts into guest pages too.
				"/vm-save.js": { headers: { "cache-control": "no-cache" } },
				// The images, loadable by the cross-origin-isolated page. Their
				// Cache-Control comes from server/range.ts on Node, and on Vercel from
				// the hit-phase route unkernel:distro-images adds (a found file only,
				// so a 404 is never cached for a year).
				"/distros/**": { headers: { "cross-origin-resource-policy": "same-origin" } },
			},
		}),
		{
			// Copy each image (a real file, never anything else from its
			// directory: vendor/build/distro also holds tar and ext4 files of
			// 100 MB and more) into the output's public/distros/ under its
			// content-addressed name (scripts/kernel.ts servedName()), after
			// Nitro's build (its buildApp hook is "post" too and comes first) and
			// so after it compressed the public files and listed its static
			// assets. The copy keeps the image's mtime. On Vercel, a route in the
			// "hit" phase (a request a static file answers) marks them immutable.
			name: "unkernel:distro-images",
			buildApp: {
				order: "post",
				async handler() {
					const s = await pageSource(false);
					if (!output) throw new Error("[kernel] Nitro gave no output directory for the images");
					const dir = path.join(output.publicDir, "distros");
					await rm(dir, { recursive: true, force: true });
					await mkdir(dir, { recursive: true });
					for (const d of s.distros) {
						const to = path.join(dir, servedName(d));
						await copyFile(d.file, to);
						const st = await stat(d.file);
						await utimes(to, st.atime, st.mtime);
					}
					console.log(`[kernel] distro images in ${path.relative(process.cwd(), dir)}/: ${s.distros.map((d) => `${servedName(d)} (${(d.size / 1048576).toFixed(1)} MiB)`).join(", ")}`);
					if (output.preset.startsWith("vercel")) await vercelImmutable(path.join(output.dir, "config.json"));
				},
			},
		},
	],
});

/**
 * Vercel (Build Output API v3): the images' Cache-Control. Nitro's route
 * rules become routes before the `filesystem` handle, which also apply to a
 * miss (the function's 404). A route after `{ handle: "hit" }` applies only
 * where a static file answered, as Next.js does for its hashed assets.
 */
async function vercelImmutable(file: string): Promise<void> {
	const config = JSON.parse(await readFile(file, "utf8")) as { routes?: Record<string, unknown>[] };
	const routes = config.routes ??= [];
	if (routes.some((r) => r.handle === "hit")) throw new Error(`[kernel] ${file} has a "hit" phase already; add the images' route to it`);
	routes.push({ handle: "hit" }, {
		src: "^/distros/[a-z0-9]+-[0-9a-f]{16}\\.(?:erofs|ext4)$", // a build's names only (scripts/kernel.ts servedName())
		headers: { "cache-control": IMMUTABLE },
		continue: true,
		important: true,
	});
	await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
	console.log(`[kernel] ${path.relative(process.cwd(), file)}: /distros/ files immutable (hit phase)`);
}

/**
 * The dev server's /_gl/virgl.mjs and /_gl/virgl.wasm: the page's GL
 * renderer files (scripts/kernel.ts), as they are on disk (gl/wasm/build.sh
 * rewrites them in place, so revalidated: no-cache), with the isolation
 * headers. 404 without a GL renderer. Likewise /_vk/kwvk-naga.wasm, the
 * Vulkan renderer's translator (vk/naga/build.sh).
 */
function serveGl(req: IncomingMessage, res: ServerResponse, next: () => void): void {
	const url = (req.url ?? "").split("?")[0]!;
	const vk = url.startsWith("/_vk/");
	if (!vk && !url.startsWith("/_gl/")) return next();
	const name = url.slice("/_gl/".length);
	void pageSource(true).then(async (s) => {
		const file = vk ? (s.vk && name === VK_FILE ? s.vk.wasm : null)
			: !s.gl ? null : name === GL_FILES[0] ? s.gl.mjs : name === GL_FILES[1] ? s.gl.wasm : null;
		const isolation = { "cross-origin-opener-policy": "same-origin", "cross-origin-embedder-policy": "require-corp", "cross-origin-resource-policy": "same-origin" };
		if (!file) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...isolation });
			return void res.end(`no ${name} on this dev server (${vk ? s.vkWhy : s.glWhy})\n`);
		}
		const st = await stat(file);
		const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
		const headers = { "content-type": file.endsWith(".wasm") ? "application/wasm" : "text/javascript; charset=utf-8", "cache-control": "no-cache", etag, ...isolation };
		if (req.headers["if-none-match"] === etag) {
			res.writeHead(304, headers);
			return void res.end();
		}
		res.writeHead(200, { ...headers, "content-length": String(st.size) });
		if (req.method === "HEAD") return void res.end();
		const stream = createReadStream(file);
		stream.on("error", () => res.destroy());
		stream.pipe(res);
	}).catch((e: unknown) => {
		res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
		res.end(`${(e as Error).message}\n`);
	});
}

/**
 * The dev server's /distros/<name>.erofs: the image of that name in the
 * page's list, answered by server/range.ts's distroReply() (one range per
 * request, uncompressed, revalidated with a strong ETag from size and
 * mtime, the isolation headers). Anything else under /distros/ is a 404.
 */
function serveDistros(req: IncomingMessage, res: ServerResponse, next: () => void): void {
	const url = (req.url ?? "").split("?")[0]!;
	if (!url.startsWith("/distros/")) return next();
	let name = url.slice("/distros/".length);
	try { name = decodeURIComponent(name); } catch {}
	void pageSource(true).then((s) => {
		const file = s.distros.find((d) => d.url === url)?.file ?? null;
		const r = distroReply(file, name, req.method ?? "GET", (h) => {
			const v = req.headers[h];
			return Array.isArray(v) ? v.join(", ") : v;
		}, `no distro image ${name} on this dev server (${s.distros.map((d) => d.url).join(", ")})`);
		res.writeHead(r.status, r.headers);
		if (typeof r.body === "string") return void res.end(r.body);
		if (!r.body) return void res.end();
		const stream = createReadStream(r.body.file, { start: r.body.start, end: r.body.end });
		stream.on("error", () => res.destroy());
		stream.pipe(res);
	}, (e: unknown) => {
		res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
		res.end(`${(e as Error).message}\n`);
	});
}
