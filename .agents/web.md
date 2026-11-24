# The browser page (`web/`)

A static page in the manner of a macOS desktop, drawn in the DOM: windows
(the page's own window manager) on a wallpaper, a Dock at the bottom, a
transparent top bar (menus, resource meters, the Control Center) and a
launcher with the apps in folders. The kernel's console and the other
terminals ([wterm](https://wterm.dev/); more sessions over vsock) are
tabs of Terminal windows; the guest's display, the guest preview
(Browser), Settings and System, an app's installer and the guest's
Wayland apps are windows too. Built with React and Tailwind (v4, a dark
theme after Vercel's Geist), Vite (client) and Nitro (server and route
rules), on the SDK from source. The top-level README.md describes it for
users.

## Files

`web/index.html`: the inline error bootstrap, the wallpaper's first paint
(from localStorage `kw.wallpaper-hint`, before any module runs) and a
static copy of the desktop as App.tsx first draws it (the console's
window, the Dock, the top bar with the boot indicator), which React
replaces in the same frame. In `web/src/` (most files are described at
their top):

- Entry and state: `main.tsx` (entry: config, renders the app, preflight
  with the SDK's `checkSupport()`), `config.ts` (the settings, kept in
  localStorage, documented at its top), `store.ts` (the UI state, read
  with `useStore()`), `ui.ts` (`KW.ui`: the imperative API boot.ts and
  main.tsx drive, plus `nextSettings()`), `kw.ts` (`window.KW`),
  `prefs.ts` (the page's small preferences, localStorage `kw.<name>`),
  `focus.ts` (whether keys typed somewhere are the guest's or the page's),
  `hooks.ts`, `format.ts`.
- The machine: `boot.ts` (terminal and boot, a separate chunk loaded only
  after the preflight passes), `sdk.ts`, `net.ts` (Wisp, and the
  plain-HTTP hosts answered with `fetch()`), `apk.ts` (apk index
  prefetch), `download.ts` (files the page fetches for the guest),
  `drop.ts` and `upload.ts` (host files dropped on the page, into the guest),
  `sudo.ts` (root in the guest: `SUDO_SH`, `execAsRoot()`), `data.ts` (the
  data disk), `session.ts` (the suspended session), `autosuspend.ts`
  (suspending in the background and the question on leaving: when,
  decided without a DOM), `display.ts` (the guest display's window, the
  mode offered, keyboard routing), `audio.ts` (Web Audio output),
  `stats.ts` (the resource sampler), `preview.ts` and `preview-ws.ts` (the
  guest preview's page side), `open.ts` (the guest's `open` and
  `xdg-open`, host commands: a URL on the guest's own address in the
  preview, any other http(s) URL in a new tab, each only after the user
  confirms), `wayland.ts` and `wayland/` (the guest's Wayland apps: wland
  on vsock and kwshm), `sw.ts` (the service worker's registration and the
  update check), `profile.ts` (`/profile.html`).
- The desktop: `wm.ts` (the window manager), `wmsnap.ts` (the tiles'
  geometry), `wmfx.ts` (the windows' effects), `appwindows.ts` (which
  launcher app a window stands for, and what the chrome calls it),
  `winmenu.tsx` (a window's menu items, shared by its Dock tile and the
  top bar's app menu), `desktop.ts` (the wallpaper), `pins.ts` (the Dock's
  pins), `keys.ts` (the shortcut table and its dispatch), `terminals.ts`
  (the terminal actions), `termtabs.ts` (the Terminal windows and their
  tabs), `wterms.ts` (terminals 1-9), `bottom.ts` (keeps a terminal at
  its bottom when it gets shorter), `autohide.ts` (the console minimizing
  itself after boot), `sysapps.ts` (the Settings and System windows),
  `launcher.ts` (how an app runs), `installer.ts` (an app's install, out
  of sight), `showcase.ts`.
- `apps/`: the launcher's apps (Launcher, below); `apps/sdlwl.ts`,
  `apps/xkms.ts` and `apps/xwl.ts` are what the SDL Wayland games, the
  apps on X on the DRM device and the Xwayland apps share.
- `style.css` (Tailwind theme, the chrome's materials, wterm's colours).
- `components/`: `App.tsx` (layout, viewport, key bar visibility, pinch),
  `Workspace.tsx` (the windows' area; it opens the console's window),
  `Window.tsx` (a window's frame), `SnapPreview.tsx`, `Wallpaper.tsx`,
  `DesktopMenu.tsx` (the bare desktop's menu), `Dock.tsx`,
  `DockStack.tsx` (a pinned group's popover), `TopBar.tsx`,
  `BootIndicator.tsx`, `ControlCenter.tsx`, `Glance.tsx` (its
  resources), `Charts.tsx`, `Launcher.tsx`, `Installer.tsx`,
  `TerminalTabs.tsx` and `Tabs.tsx`, `KeysHud.tsx`, `KeyHint.tsx`,
  `Keys.tsx` (the key bar), `Menu.tsx`, `Apps.tsx` and `AppShell.tsx` (the
  system apps' portals and frame), `Settings.tsx`, `Options.tsx`,
  `DesktopSettings.tsx`, `SystemInfo.tsx`, `Overview.tsx`, `About.tsx`,
  `Display.tsx` and `Pad.tsx` (the display's content: rotation, mouse and
  touch input, touch controls), `Preview.tsx` (the Browser's content),
  `WaylandOutput.tsx`, `Dialog.tsx`, `Overlays.tsx` (the confirm and paste
  dialogs, the Resume card, the toast), `icons.tsx`.

`src/env.d.ts` declares `__KW_BUILD__`,
which `vite.config.ts` defines: the Linux release read from the committed
kernel's banner, the kernel's release tag and the page's commit (empty
where git is missing or the clone is too shallow). `web/public/vm-sw.js` is the page's
service worker (the preview's relay), `web/public/vm-ws.js` the preview's WebSocket shim, `web/server/vm.ts` the preview's server fallback,
`web/server/distros.ts` the built Node server's `/distros/` handler and
`web/server/range.ts` the Range logic it shares with the dev server,
`web/scripts/kernel.ts` what the page runs (below).
`web/public/manifest.webmanifest` makes the page installable (standalone, black); its icons
`icon-192.png`, `icon-512.png` (the whole logo at 6x and 16x), `icon-maskable-512.png` (inside the
border, corners filled, opaque) and `apple-touch-icon.png` are `assets/logo.svg` rendered at 32 px
and scaled nearest neighbour (`magick -filter point`).
`web/vite.config.ts` holds the COOP/COEP headers (Nitro route rules, plus
the dev server's own responses), `__KW_BUILD__`, `virtual:unkernel-kernel`
(the kernel's URLs, the GL renderer's URL and the list of images), the dev
server's `/distros/` and `/_gl/` middleware, and the build step that copies
the images into the output (below).

## The page's kernel and distro images

The page runs the base bundle `unkernel.wasm` (the kernel and the base
initramfs, with the data disk template and the SMP patch section) and boots
it with a read-only distro image (`alpine.erofs`, `debian.erofs`) that it
attaches by URL and reads lazily with Range requests (the SDK's
`createKernel({ distro })`, js.md, Disks). `pageSource()` in
`web/scripts/kernel.ts` (described at its top) picks both when the dev
server starts or a page build begins (the `unkernel:kernel` plugin's
`config` hook in `vite.config.ts`, before anything is served or built), and
logs which and why (a build between two lines of `=`). Building or
deploying the page needs no kernel toolchain.

- The source, in this order:
  1. `KW_KERNEL=<file>` and/or `KW_DISTROS=<dir>` (relative to `web/`):
     that base bundle and the images in that directory (`<name>.erofs`, or
     `<name>.ext4` where there is no `.erofs`; `distros.json` there gives
     image ids), the other part from the local build, whatever `KW_LOCAL`
     says.
  2. A local build, when one may be used: `KW_LOCAL=1` forces it,
     `KW_LOCAL=0` forbids it, and by default it is used unless `CI` or
     `VERCEL` is set (a deploy or CI build has no `vendor/` and must ship
     a release). It needs `vendor/build/bundle/unkernel.wasm` (`kernel/build.sh
     base`) and at least one image in `vendor/build/distro/`
     (`kernel/build.sh distro`; both from `kernel/build.sh all`).
  3. Else the newest non-draft release of `pithings/unkernel`
     (`.github/workflows/release.yml`; `KW_KERNEL_RELEASE=<tag>` picks
     one), which must carry `unkernel.wasm`, `distros.json` and every image
     `distros.json` names. A release without them (every release before
     the base bundle: `unkernel-alpine.wasm` only) fails the build with
     what to do: build locally (`kernel/build.sh all`), cut a release, or
     name a release that has them. So a deploy (Vercel) and CI ship a
     release, never a local build.
  1 and 2 show as "local build" in About (Settings), 3 as the release's tag.
- A release is downloaded at build time (the dev server only when it has no
  copy yet, and then without a network check), because GitHub serves
  release assets without CORS (both the `github.com` redirect and
  `release-assets.githubusercontent.com`), so the browser cannot fetch
  them, and CDNs such as jsDelivr only serve files from the git tree. The
  copy is `web/kernel/release/` (gitignored: `unkernel.wasm`,
  `distros.json`, the images, `release.json` with the tag and every file's
  sha256). Everything is checked in a temporary directory before it
  replaces that copy (a rename), so a refused or broken release leaves
  `web/kernel/` as it was: `distros.json` first (its `abi` must be
  `include/kw_emu.h`'s `KW_ABI_VERSION`, its entries well formed), then
  `unkernel.wasm` (the API's sha256 digest where there is one, wasm magic,
  its own ABI from `kernelInfo()` in `kernel/tools/bundle.mjs`, its base
  id against `distros.json`'s `base`, `bundleInfo()` in
  `guest/tools/distros-json.mjs`), then each image (size and sha256 from
  `distros.json`, and the API's digest). An image the copy already has
  with that sha256 is reused, and a build whose newest release is the
  copy's downloads nothing. The GitHub API gives the newest release and the
  digests; without `GITHUB_TOKEN` (or `GH_TOKEN`) it allows 60 requests an
  hour per IP, so on any API failure the build reads the newest tag from
  `releases.atom` and downloads from the usual URLs (no digests; the
  sha256 in `distros.json` still checks the images). If GitHub cannot be
  reached, a build keeps the copy (when it is the tag asked for).
  `KW_GITHUB_API` and `KW_GITHUB` replace `https://api.github.com` and
  `https://github.com`, for a stand-in server. Checked 2026-11-19 against
  such a stand-in: a complete release built and booted (Alpine, Debian),
  a second build downloaded nothing, and a release without
  `distros.json`, one without an image, one whose `distros.json` says
  another ABI and one with a wrong image sha256 each failed with
  `web/kernel/` unchanged; the real newest release (v0.1.0-261117-0e4b2ec)
  fails with that message.
- The kernel must match the page: a local base bundle whose kwemu ABI is
  not `KW_ABI_VERSION` only gets a warning, a release is refused (above).
  The page's texts and apps (the Ubuntu app's arm64 tarball, the
  launcher's aarch64 packages) are written for this checkout's guest.
  Order after an ABI or guest change: merge, cut a release (the workflow),
  then deploy the page; a page build that takes the newest release before
  then (CI, Vercel, `KW_LOCAL=0`) fails (or give `KW_KERNEL` and
  `KW_DISTROS`, `KW_LOCAL=1` or a matching `KW_KERNEL_RELEASE`). A
  release changes a deployed page only once the page is rebuilt.
- The kernel's URLs (`virtual:unkernel-kernel`'s `kernelUrl` and
  `kernelSmpUrl`, which `src/sdk.ts` exports): `baseSplit()` takes the
  SMP patch section off the bundle: the UP kernel is the bundle without it
  (byte for byte the bundle when it has none), the SMP one the kernel the
  patch makes with the same initramfs, command line and data disk template
  (js/core/kpatch.ts; `kernelSmpUrl` is null without the section). A build
  emits both from memory as hashed assets (`unkernel-<hash>.wasm`,
  `unkernel-smp-<hash>.wasm`), so it never touches the dev server's files;
  the dev server writes them to `web/kernel/page/<16 hex digits of the
  bundle's sha256>/` (`splitBase()`; the four used last are kept, so dev
  servers of different bundles do not overwrite each other) and serves
  them as `/@fs/` files, split again when a local bundle changes. UP
  visitors download only the UP kernel (8.4 MiB, about 4.7 MiB
  compressed); only a load with several CPUs fetches the SMP one (Several
  CPUs, below).
- The images' URLs and caching, with `virtual:unkernel-kernel`'s
  `distros` list (`{ name, url, size, imageId? }`, debian first;
  `imageId` where `distros.json` gives it, else the page reads it from
  `/run/kw-base`):
  - A build names each image by its content,
    `/distros/<name>-<16 hex digits of its sha256>.erofs`, and copies it
    (a real file with the source's mtime; never anything else from its
    directory, whose tar and ext4 files are 100 MB and more) into the
    output's `public/distros/` (`.output/public/distros/`, on Vercel
    `.vercel/output/static/distros/`) in the `unkernel:distro-images`
    plugin, whose `buildApp` hook runs after Nitro's. That is after Nitro
    compressed its public files and listed its static assets:
    `compressPublicAssets` has no filter and compresses every file whose
    type it does not know as text, and Nitro's static handler (which does
    answer single ranges) would then send the `.br` variant. Such a URL
    never changes content, so it is `cache-control: public,
    max-age=31536000, immutable`, with the strong ETag
    `"<hash>-<size in hex>"`, the same on every server and deploy. A new
    image is a new URL, so a session suspended on the old one is not
    resumed (Suspend and resume).
  - The built Node server answers them in `web/server/distros.ts` (a Nitro
    handler for `/distros/**`, reading `../public/distros/` next to its
    `index.mjs`). On Vercel the CDN serves them as static files (its
    `config.json` has the `filesystem` handle before the function's
    `/distros/` route), with its own Range support and ETag; the
    `/distros/**` route rule adds CORP, and `unkernel:distro-images` adds
    a route in the `hit` phase (a request a static file answered) that
    sets the immutable Cache-Control, so a 404 from the function is never
    cached. Checked 2026-11-19 in the build output only, not on a
    deployment.
  - The dev server answers `/distros/<name>.erofs` itself (the
    `unkernel:kernel` plugin's middleware; Nitro's dev handler answers
    public files br-compressed, in full and without Range support) from
    the files the list names, wherever they are. A local image is rebuilt
    in place, so these plain names are `cache-control: no-cache` with an
    ETag from size and mtime. The SDK's opening request revalidates (a 304
    while the image is unchanged); its other requests take the browser's
    cached copy anyway (`force-cache` ignores `no-cache`), and after a
    rebuild their old ETag fails the check against the opening one, so
    they are fetched again (below). The list's sizes are read again when
    an image changes (on the next page load). Earlier dev servers linked the images into
    `web/public/distros/` (gitignored); that directory is unused, and in
    Nitro's `ignore`.
  - What the SDK asks of the server (js/core/block.ts `HttpBase`): it
    opens an image with one Range request for its first 256 KiB with
    `cache: "no-cache"` (the one request that revalidates), then reads the
    prefetch the image's distro header names (Alpine: the whole image, one
    plain GET; Debian: one streamed Range request of its first 4 MiB), the
    background tier it names once the guest has read the image and the
    boot is quiet (Debian: the warm set, apt's files, from 4 to 27 MiB, in
    4 MiB Range requests one at a time),
    and lazy and read-ahead ranges (256 KiB-aligned; read-ahead up to 4 MiB),
    all `cache: "force-cache"`, comparing each response's
    ETag with the opening one's and fetching a mismatch again with
    `cache: "reload"`. So every response for an image, 200 and 206 alike,
    must carry the same strong ETag, be cacheable (never `no-store`) and
    not be content-encoded (a 200's Content-Length is checked against the
    image's size).
  - The dev middleware and the Node handler share `web/server/range.ts`:
    no compression, 200 for a request without Range, 206 with
    Content-Range for one range (a malformed or multi-range header gets
    the whole file), 416 with `bytes */<size>` past the end, one ETag per
    image on every response (a rebuilt image changes it, and the SDK's
    strict `HttpBase` then refuses reads instead of mixing two images),
    If-None-Match before Range (RFC 9110: a cached range revalidates with
    a 304), If-Range, COOP/COEP/CORP, and 404 (`no-store`) for anything
    else under `/distros/`. Vercel's CDN sends its own ETag; whether it is
    the same on a 200 and a 206, and across its edges, is not checked (a
    differing one costs a refetch, never a mixed image).
  - Measured 2026-11-19, headless Chromium (Playwright's build), one
    profile, the same load twice, `?data=0`, to the prompt: on the built
    Node server Debian made 20 requests, 18.9 MiB, the first time (prompt
    2.2 s); the second time only the opening request reached the network
    (a 304, 423 bytes) and 19 came from the HTTP cache (prompt 0.52 s);
    Alpine 2 requests, 4.1 MiB (0.36 s), then 1 on the network (304) and 1
    from the cache (0.34 s). The dev server: the same counts (Debian's
    second load 0.67 s).
- The guest GL renderer (`virgl.mjs` and `virgl.wasm`, gl/wasm; Guest GL,
  below), optional, picked with the kernel (`withGl()` in
  `web/scripts/kernel.ts`): `KW_GL=<dir>` (`KW_GL=0`: none), else with a
  local kernel `vendor/build/gl-wasm/` (`gl/wasm/build.sh`), else the
  release's `virgl.mjs` and `virgl.wasm` assets (the release workflow
  attaches them; a release without them, every one before guest GL, gives
  none and the page builds without GL: `release.json`'s `gl` is null). The
  build log's `GL renderer:` line says which. `virtual:unkernel-kernel`'s
  `glUrl` (null without one; `src/sdk.ts` passes it to `webPlatform()`):
  in a build both files are emitted under fixed names into
  `/assets/virgl-<16 hex digits of their sha256>/` (virgl.mjs loads
  `./virgl.wasm` next to itself, so neither may be renamed alone); the dev
  server answers `/_gl/virgl.mjs` and `/_gl/virgl.wasm` itself (`serveGl()`,
  `no-cache` with an ETag, untransformed: Vite would rewrite the module).
  Either is fetched only by a load with GL on, on the guest's first GL use
  (the SDK imports the module then; Guest GL, below).
- `web/src/sdk.ts` imports `js/core/index.ts`, `js/web/memory.ts` and
  `js/web/platform.ts`, not `js/web.ts`, whose own bundled kernel would
  become a second 10 MB asset. Its `kernelUrl` is a hashed Vite asset,
  which the Node server sends precompressed (br, zstd, gzip). Compressed
  responses have no decoded length, so there is no download percentage.
- `vite.config.ts` keeps the dev server from watching `.output/`,
  `.vercel/`, `kernel/release/` and `kernel/page/`: a page build rewrites
  `index.html` there, which would reload an open dev page and end its VM.

## Rules

- Settings live in localStorage `kw.settings` (config.ts `SETTINGS_KEY`:
  the parameter names and values, only those that differ from the
  defaults). Reboot saves the options there and loads the bare URL; a URL
  parameter of the same name overrides the saved one for that load (the
  browser tests use that), and the page never writes the URL (where
  localStorage refuses, Reboot puts them in the URL instead). Every saved
  setting except `?shared` has a control in Settings (`Options.tsx`'s
  groups, shown in Settings' sections; the store's `options`,
  `nextSettings()`); `?simulate`, `?showcase`, `?routes` and `?autohide`
  are URL only, and so are the this-load-only `?gpu`, `?shm`, `?wlgpu`,
  `?glload` and `?glwait`. A new setting needs a control too. The desktop
  test checks the mapping. The fields are controlled, and also read by
  native listeners on the form, because React drops change events for a
  value set from script (the test does that).
- `window.KW` is what the browser tests read (`KW.windows`, `KW.wm`,
  `KW.wayland`, `KW.ui`...), together with the element ids: `#desktop`,
  `#workspace`, `#term` and `#term-tab-N`, `#topbar` with `#tb-status`
  (the Control Center's item; red on an error) and `#tb-cc-system`,
  `#dock`, `#dock-launcher`, `#dock-wayland`, `#launcher-grid` and
  `#launcher-folder` (tiles by `data-folder` and `data-app`),
  `#installer-<app>` and its parts, `#system` and `#settings` (class
  `open` while their window shows), the options' `#opt-*`, `#confirm`,
  `#keys`, `#fb-layer`, `#wl-desktop`. Keep them working.
- Safe areas are the CSS variables `--st`, `--sr`, `--sb`, `--sl` (style.css). On iOS,
  `--sb` is three quarters of the bottom inset: the Dock sits that far above the bottom
  edge, over the wallpaper that goes on under the home indicator, and moves its ends in
  by `--sc` (half the bottom inset) for the round corners. While the on-screen keyboard
  is up (`App.tsx` sets `kb` on the root when the visual viewport is well below the
  layout viewport) both are 0 and the top bar and the Dock are hidden (the key bar
  stays). In an iOS home screen app `--st` is 24 px more than the top inset: iOS fades
  the page's top 20 px or so there.
  On macOS outside fullscreen, `main.tsx` sets `mac-window` on the root and `--sc` is
  8 px, for the window's round bottom corners, which the Dock would run into.
  In a home screen app (standalone) `App.tsx` sizes `#app` to the layout viewport's height
  unless the keyboard is up (the visual viewport can stay short after it closed). The
  status bar style is `black`, not `black-translucent`: with that, iOS 26+ makes the
  viewport shorter than the screen by the status bar and shows nothing below it (WebKit
  bug 301108). iOS reads the style when the app is added to the home screen.
- The tab's title is `<mark> unkernel`: one character for the machine's
  state (ui.ts `titleMark()`, from the store's state, label and
  `suspended`, set in the store's listener, so synchronously with each
  change and before a hidden page may be frozen): `▶` (U+25B6 with U+FE0E,
  text presentation) running, `‖` paused (held in the background or by
  Pause) or suspended, `…` starting, resuming or suspending, `■` halted or
  powered off, `!` failed. Only that mark is replaced; the rest of the
  title is kept as found.
- An unknown or failed boot step must end in `ui.fail(...)`, so the top
  bar's status (and the boot indicator, while the boot is not over) turns
  red and System's window opens on Errors. The page must never stay blank.
  `index.html` installs `error`/`unhandledrejection` handlers first and
  reports the page module if it has not run after 8 s; `main.tsx` imports
  the boot chunk only after `checkSupport()` passed. A missing feature, a
  module that fails to load, a 404, a failed allocation, a panic or a trap
  all end there.
- Memory: the default is the SDK's `autoMemoryMiB()` (2 GiB on desktops,
  512 MiB on phones, less with a low `navigator.deviceMemory`); if the browser
  refuses the allocation the runtime retries with
  `DEFAULT_MEMORY_FALLBACK_MIB` (1024 down to 64, `js/web/memory.ts`).
  Alpine boots in 48 MiB.
- Keyboard shortcuts (`keys.ts`, described at its top; its `COMMANDS`
  table is what Settings' Keyboard section and the shortcuts HUD list):
  Ctrl-A is a prefix as in GNU screen, and ⌘A too on Apple devices (it
  takes nothing from the guest; ⌘ may stay held for the key); Ctrl-A
  twice sends one Ctrl-A on. Digits are terminals, as windows are in
  screen and tmux (0 the console; also Ctrl-Shift-digit, which terminals
  and browsers leave unused), and the arrows snap the focused window, so
  new shortcuts use letters. A new tab is n or c (as in tmux), a new
  Terminal window N, x closes the current terminal; the launcher is o,
  also ⌘K on Apple devices (a `meta` code in COMMANDS; Ctrl-K is
  readline's kill-line, so not that elsewhere) and Ctrl-Shift-O; p the
  Browser, d the Display, w the Wayland windows, z Suspend, r Reboot, y
  Copy diagnostics, and s, g, i, l, e, ?, `,` and a open the system apps
  on a section. Controls name their command by its id (`keyFor()`), so
  the hints on the Dock, the top bar, the tabs and the menus follow the
  table. The listener is on window in the capture phase and is added
  before display.ts's, so the shortcuts work while a program holds the
  evdev keyboard; key-ups always pass, so a Ctrl the guest saw go down
  comes up. In a system app's window Esc closes it.
- Questions use `ui.ask()`, a native modal `<dialog>` (`#confirm`,
  Dialog.tsx `Alert`), never `confirm()`; it releases pointer lock first,
  and keys typed in it go no further. One the guest asks (`untrusted`:
  `open.ts`) takes OK, Enter and y only after a moment, so a key meant for
  the terminal cannot confirm it. Options are real inputs, so keyboards
  and screen readers work on them.
- Display and input (`display.ts`, `Display.tsx`, both described at their
  top): the guest's display is a window (id `display`, Dock tile
  `#dock-display`, Ctrl-A d) that opens, focused, when a program attaches
  it and goes when it lets go; closing or minimizing it only hides the
  picture. The mode offered to the guest is the window's content box in
  CSS pixels (before the window exists, the box it would open at: its
  last geometry, else a 4:3 box in the workspace's middle; turned while it
  covers a portrait phone turned), and the canvas is scaled to fit. kwfb
  takes it at a program's first open; virtio-gpu (guest GL) is told when
  the box settles at another size while shown (a ResizeObserver,
  `vm.updateDisplaySize()` 300 ms after the last change: the window
  resized or maximized, the page resized, full screen, rotation), a
  hotplug with the new preferred mode; the canvas follows the mode the
  guest then sets (gl.md, Display size). While the Display window has the
  focus and a program has the evdev keyboard open, keys go to it; other
  windows keep theirs. With the tablet open the pointer goes there as
  absolute positions and nothing locks; this wins when both mice are open.
  Otherwise a click with the relative mouse open takes pointer lock. On
  touch devices the window may cover the whole page, Dock and top bar
  included (`#fb-cover`: a quarter turn while the page is portrait and the
  rotate option is on, or unturned in full screen). Phone keyboards send
  no usable keydowns, so a hidden input's value is diffed against a
  sentinel and sent as US-layout key presses. Pointer positions under
  rotation go through `unturn()`/`localPos()` (display.ts). Touch layout
  choices are in localStorage (`kw.*`).
- Terminals (`wterms.ts`): 0 is the console (hvc0, boot.ts), 1-9 are
  `vm.spawn()` sessions (js.md), each its own wterm (`.term-pty`), each a
  tab of a Terminal window (The desktop, below). Output is read all the
  time, shown or not, since an unread `Pty` blocks its programs (a hidden
  terminal only has its painting paused); the reader takes the next chunk
  only after `write()` returned and yields a task (a MessageChannel, which
  background tabs do not throttle) every 16 ms or 256 KiB. A tty N tab is
  titled with its foreground program (one `vm.exec()` a second reads them
  from /proc while such a terminal is open). The shell exiting closes its
  tab; the kernel stopping closes them all. `KW.windows` is their API
  (named so for the tests: its windows are the terminals), which
  `test/wland/page-check.mjs` types through. Every session is detachable
  (`detachable: true`), so it survives Suspend and resume (below).
- Worker mode (the default where the page is cross-origin isolated, else
  off; `?worker=0` / `?worker=1` pick; implied by several CPUs) boots through the SDK's worker mode (js.md):
  the page compiles the kernel and passes the `WebAssembly.Module`; disks
  and the network are specs built in the worker. The data disk in worker
  mode follows data-disk.md (Persistence in the browser). `KW.kernel` and
  `globalThis.kernel` stay unset, so the browser tests (whose
  `page.type()` uses `kernel.sendInput()`) run inline only: lib.mjs
  `goto()` adds `?worker=0&cpus=1` unless the URL has them. A default
  worker (no `?worker=`) that does not start (a `support` BootError, or
  no report within 20 s) reloads once on the page's thread
  (`bootUpOnce(..., inline)`, sessionStorage `kw-inline-once`); every
  other way an asked worker can fail ends in `ui.fail`.
- Sound is an AudioWorklet fed by postMessage, because the kernel calls
  the import from a busy main thread; scheduled buffers are the fallback
  where there is no secure context. Checked by hand only.
- Every response carries COOP/COEP. A secure context is therefore
  cross-origin isolated, which worker mode's shared transport needs (the
  kernel's own memory is not shared). Anything cross-origin that the page
  loads must send CORP or be fetched with CORS (the wallpaper photos);
  WebSockets are exempt.
- The guest network is Wisp, plus `fetch()` for the plain-HTTP hosts of
  `DEFAULT_ROUTES` (config.ts: deb.debian.org through the page's CORS
  mirror, apt.ladybird.org through its /ladybird, and mirror.unkernel.dev
  itself, whose other paths are asked before the upstreams: /github and
  /ollama (llama.cpp's and Ollama's release files, Ollama's registry) by
  the llama.cpp and Ollama apps' scripts, and /claude, /nodejs, /opencode,
  /astral and /github/astral-sh/uv by the install shim, only where the
  name resolves to a routed address (it checks nothing against a
  checksum); the Ubuntu app's tarball is the page's own fetch of /ubuntu; `?routes=0` sends them
  through Wisp too). A page served from an origin outside the
  Wisp server's allow list needs its own Wisp server (js.md). A `ws://`
  server is blocked as mixed content on an `https://` page.
- The distro (above): `?distro=<name>` (default `debian`, else the first
  image; an unknown name boots the default, with a warning line, a toast,
  the Distro row in System's Environment and the option's note; `none` attaches
  no image: the base shell). Its option is Settings' Distro radios
  (`#opt-distro-<name>`, `#opt-distro-none`, `#opt-distro-note`). Inline,
  boot.ts opens the image with `openDistroDisk()` while the kernel
  downloads, so the resume check sees the snapshot's disks (`[distro,
  data]`); worker mode passes the URL. The image is the read-only
  `/dev/wda`, the data disk `/dev/wdb`. The bundle's own command line is
  used unless `?append=` gives one (`?root=` appends `kw.root=`). Once
  user space runs, boot.ts reads `/run/kw-base` (guest/base/initramfs/init)
  for the Distro and Root rows, About (the image id) and diagnostics'
  config line (`distro=`, `image=`). Where a feature or text is Alpine's
  (apk, wget), it is gated on `cfg.guest === "alpine"` (Rules,
  Launcher). Failures: an image that does not open (404, a
  server without Range, not erofs/ext4) is `ui.fail` (kind `distro`, with
  a hint); a read that fails later (the image changed or the server
  stopped; the guest gets EIO) is a non-fatal `KW.report`; the base's
  base shell (`unkernel base shell (...): why` on the console) is a
  warning row and a report. Checked 2026-11-19 with headless Chromium (a
  scratch script, not in `web/test/`) on the built Node server and the dev
  server, from a scratch build of the current sources: both distros, the
  switch through the Distro option and Reboot, per-distro changes on the data disk,
  `?data=0`, `?worker=1`, `?cpus=2`, `?root=initramfs`, `?distro=none` and
  an unknown name, suspend and resume (inline and worker) and the refusal
  across distros, the data disk reset (`KW.resetData()`), and the
  failures above (404, no Range, a changed ETag, by request interception).
  To the prompt, Debian 0.9 s and Alpine 0.3 s on the Node server with a
  cold cache (caching above).
- apk index prefetch (`apk.ts`, described at its top): on the alpine
  image only. Once user space
  runs, the page pushes the guest's missing or stale APKINDEX files into
  `/var/cache/apk` through `vm.exec()` (as root: `execAsRoot()`, sudo.ts), so apk skips its own index download.
  That covers the enabled repositories and the lazy ones in
  `/etc/kw-apk-lazy` (community), which kw-apk-install reads before it
  enables one (kernel/guest.md). It fetches them as plain http over its own Wisp connection (the mirrors
  send no CORS headers; apk checks the signature on every load) and keeps
  them in the Cache API (`kw-apk-index-v1`), revalidated after 1 h. The
  pushed file's mtime is the time the mirror last confirmed it. Off with
  `?net=0`.
- `~/README` (intro notes) comes from the image, not the page
  (kernel/guest.md); its section on the page names the page's shortcuts
  and options: keep them in step with the page.
- The safe-mode explanation comes from watching the console for
  `kw-overlay: SAFE MODE:` (`boot.ts`, see data-disk.md): the base's check
  of the root with the data disk's changes failed, so this boot runs the
  plain image on a tmpfs upper; the changes stay in
  `/data/distros/<name>/upper`, and every boot checks them again. The
  note in Settings' Storage section (`#data-safe-note`), a toast and the
  Root row say so, with `kw-overlay status` and `kw-overlay discard`.
  `?root=initramfs` (Storage's Safe mode button, `#data-safe`; the Control
  Center's Leave safe mode ends it) is the same for one boot by choice.
- A guest `reboot` (halt code 2) reloads the page once the last data-disk
  save has committed, at most 3 times a minute per tab (sessionStorage
  `kw-auto-reboot`); then the page stays halted and says why.
- Kernel messages go to System's Kernel log; during boot only the newest
  shows on a transient line, and IMPORTANT ones (`js/core/console.ts`) are
  written in full. Once user space prints, "Started Linux" (the kernel until
  it runs `/init`), "Started Alpine" (the base mounting the image and the
  distro's init; "Started the base shell" without one), the "Booted
  in" summary, two notes (the repository as an OSC 8 link, and how to
  open the app launcher; not on a resumed session), with Pip from the
  logo (`assets/logo.svg`) in truecolor half blocks to their left when
  the terminal is wide enough, and the buffered
  user-space output follow; nothing is scrolled away or erased. The desktop test checks the order.
- wterm (`@wterm/dom`, Apache-2.0; xterm.js was dropped because its touch
  scrolling had no momentum) renders rows as DOM text, and `#term` (and
  each `.term-pty`) is itself the scroll container, so it must not set
  `overflow`. When one gets shorter while scrolled to the bottom, it is
  put back at the bottom before wterm refits (`bottom.ts`: App.tsx for the
  console, wterms.ts for the others; wterm would otherwise show the prompt
  behind the keyboard). Workspace.tsx makes `#term` once, in the console's
  window, and nothing touches it again. A Terminal window's tabs are
  stacked in one box (`.term-stack`), the inactive ones hidden with
  visibility, so they keep their grid and size. wterm takes the row
  height from `--term-row-height`, so `setTermFont()` sets both together.
  `KW.screenText()` reads its core directly, because `readText()` is async.
- Phones never zoom the page: a pinch on the desktop (not over the
  display) sets the font size, two-finger touchmoves and Safari's
  `gesture*` events are cancelled (iOS ignores `user-scalable=no`), and
  wterm's hidden textarea is 16 px, because iOS zooms on focusing a
  smaller field.

## The desktop

- Window manager (`wm.ts`, described at its top; React only draws it:
  Workspace.tsx, Window.tsx, Dock.tsx). The modules that own windows open
  and drive them through `wm` (termtabs.ts, display.ts, preview.ts,
  sysapps.ts, installer.ts, wayland/), never through React, each with a
  `WindowSpec`: a stable id; `meta` (apps/types.ts `AppMeta`: the name,
  icon and key the top bar, its Dock tile and its title bar show); a
  frame (`normal`, or `none` for an app that draws its own decorations and
  starts moves and resizes itself); content (an element mounted once and
  never recreated, so an app may keep state in it, or a React node);
  geometry in workspace px; `closable`, `resizable` (a fixed-size window:
  an installer); and callbacks (`onClose` may refuse, `onFocus`/`onBlur`,
  `onVisible`: a hidden window's app stops painting, `onResize`). Windows
  stay in the order they opened (the Dock's and the DOM's) and z-index is
  the z-order, so raising one moves no DOM node. One window has the focus:
  the top one that is not minimized. A minimized window keeps its box
  (visibility, inert), so a terminal keeps its grid and its size and the
  API reads it as before.
- The workspace (`#workspace`, in `#desktop`) is the area between the top
  bar and the Dock, inside the safe areas. Compact mode (phones,
  `KW.config.mobile`, and viewports below 640 px, `COMPACT_PX` in
  Workspace.tsx): every window is drawn maximized with a slim strip for
  its title, only the top one shows, and the Dock is the switcher; the
  geometry is kept for when the viewport widens.
- Snapping (`wmsnap.ts`): a window dragged by its title bar to the
  workspace's sides or corners tiles to a half or a quarter (to the top
  edge: maximized), with a preview under it (SnapPreview.tsx); Ctrl-A and
  an arrow does the same from the keyboard. A window's own geometry is
  kept apart from its tile, so Restore, a drag out and the keys go back
  to it, and tiles follow the workspace's size. Not in compact mode.
- Effects (`wmfx.ts`): macOS-like open, close, maximize and a genie-like
  minimize into the window's Dock tile, transforms and opacity only (the
  Web Animations API on the window's element, so its content rides one
  composited layer unpainted). The WM's state changes at once; a closed
  window's ghost is drawn until its effect ends. Off with
  prefers-reduced-motion, in compact mode, during a move or resize, in a
  hidden tab and for the first render's windows.
- Terminal windows (`termtabs.ts`, `terminals.ts`): a Terminal window (id
  `terminal-K`, Dock tile `#dock-terminal-K`) holds an ordered set of
  tabs, one per terminal (`#term-tab-N` in its title bar,
  TerminalTabs.tsx), and a terminal is a tab of exactly one window. The
  console's window (`terminal-1`) is opened by Workspace.tsx when it
  loads, with `#term` in it, and never goes: its tab cannot be closed or
  moved, and it has no close button or Close Window entry (only minimize). Any
  other window goes with its last tab. A new terminal (Ctrl-A n, the tab
  strip's +) goes into the Terminal window that last had the focus;
  Ctrl-A N, or a right click, Shift-click or long press on +, into a new
  one. A Terminal window whose only tab is a terminal app's terminal is
  shown as that app (its icon and title on the Dock and the top bar).
- Dock (`Dock.tsx`, whose header lists its ids): the launcher
  (`#dock-launcher`), the pinned apps and groups (`#dock-group-<id>`,
  `#dock-settings`; a pinned tile has its window's id where it stands for
  one, `#dock-terminal-1` for Terminal, else `#dock-app-<id>`), then a
  tile per other open window (`#dock-terminal-K`, `#dock-display`,
  `#dock-preview`, ...), and while wland's relay is connected
  `#dock-wayland` (Ctrl-A w). Pins (`pins.ts`): localStorage `kw.pins`, an
  ordered list of app ids and `group:<id>` (by default Terminal, the Browsers,
  AI, Desktop, Graphics and Games groups, and Settings), changed from the
  tiles' and the launcher's menus (Keep in Dock, Remove from Dock, Move
  Left, Move Right); an entry the registry no longer has is kept but not
  shown. A pinned app's tile stands for its window (`appwindows.ts`
  `windowApp()`: a page app's own window, a terminal app's Terminal or
  Wayland window, its installer), which then has no tile of its own; a
  pinned group's tile opens its apps in a stack above it (DockStack.tsx,
  `#dock-stack`: a macOS Grid stack, the group's title over its apps on
  a panel of the Dock's glass with a notch pointing at the tile, growing
  out of it). A mouse resting on a group's tile (within 5 px) for 500 ms
  opens its stack without moving the focus, and with one open, resting on
  another group's tile for 130 ms switches to it (500 ms on the way from a
  tile to its stack); it closes 300 ms after the pointer has left the tile
  and the stack (`OPEN_DELAY`, `SWITCH_DELAY`, `GRACE` in Dock.tsx). A click opens
  it pinned (or pins a hovered one) until a click on the tile, a press
  elsewhere or Esc; a tap (touch, a pen) and Enter or Space toggle it as a
  click does, the keyboard's putting the focus in it. A tile's menu or the
  launcher closes it (Dock.tsx's header has the rules). Tiles magnify under
  a mouse and show a label above them at once (`#dock-label`: the name,
  the state, the key; no native tooltip; a group's tile shows its stack
  instead), a running dot (busy faint, error red) and an install's bar. A
  click shows a window, or minimizes the focused one (not in compact
  mode); a right click, a long press or Shift-F10 opens the tile's menu
  (`winmenu.tsx` `windowItems()`, the same items as the top bar's app
  menu). The tiles scroll sideways when they do not fit.
- Top bar (`TopBar.tsx`, `#topbar`): no background over the wallpaper, a
  blurred tint over a window. The current app, one control (its icon, as
  on its Dock tile, the focused window's `meta` title, then its own title
  in a quieter tone; unkernel's mark and "Desktop" with none), a menu of
  the window's items (`#tb-app`), and in its place until user space prints the
  boot indicator (BootIndicator.tsx, `#tb-boot`: a ring with the boot's
  progress and the step, red with the failure's title, a press opens
  System); on the right Errors (`#tb-errors`) while there are any, the
  resource meters (`#tb-cpu`, `#tb-mem`, from sm up `#tb-disk`, `#tb-net`,
  and `#tb-gpu` while guest GL's or guest Vulkan's renderer is loaded: its
  bar the share of the page's time the two renderers took together, its
  tooltip each one's figures), which open
  Resources, and the Control Center's item (`#tb-status`,
  `#tb-status-label`). The bar always shows:
  its auto-hide over a maximized window is off (`auto` in TopBar.tsx; the
  code for it stays).
- Control Center (`ControlCenter.tsx`, `#tb-cc`), opened by hovering or
  clicking `#tb-status`:
  the state and the uptime, quick buttons for what applies at once (full
  screen, the next random wallpaper, the Display window), Settings…, System…
  (`#tb-cc-system`), the kernel log, the shortcuts and About, and the
  power items (`#tb-suspend` or
  `#tb-resume`, `#tb-reboot`: "Reboot to apply" while Settings' options
  differ from this boot's, and it asks first; Leave safe mode in safe
  mode). Boot options stay in Settings.
- Resources popover (`ControlCenter.tsx`, `#tb-res`), opened by hovering
  or clicking a meter (that resource's row marked), under the last meter:
  every resource's sparkline and facts (`Glance.tsx`; `#tb-gpu` marks both
  GPU rows, GPU for guest GL and Vulkan), then System…
  (`#tb-res-system`). One of the two popovers is open at a time.
- Resources (`stats.ts`): one sampler for the meters, the Resources
  popover and System's Overview, never two reads at once: a `vm.exec()` of a POSIX
  sh snippet of builtins only (no program started, nothing read from the
  image) that prints the guest's `/proc` (every few samples also `df`),
  with the SDK's host counters, guest GL's (`vm.gl`) and guest Vulkan's
  (`vm.vk`: status and stats, read only, never `load()`; without `vm.vk`,
  the option off or no WebGPU, no Vulkan row or panel, as for GL; before
  the guest's first VkInstance its state, "not loaded"). Vulkan's rates
  per sample: presents (all, and by external buffer: zero-copy; the rest
  read back), draws, dispatches, submits, bytes to the GPU and read back,
  and the renderer's share of the page's time (its parse, translate and
  encode ms); a new renderer after a device loss gives no rates across it.
  Its errors and device losses show in red. A light sample every 5 s
  for the meters, a full one every 2 s while the Resources popover or the
  Overview shows; only while the page is visible and the machine runs; the
  last 90 samples kept for the charts.
- Shortcuts HUD (`KeysHud.tsx`): 180 ms after the prefix is armed, a
  drawn keyboard with every bound key lit (its word and its group's
  colour; a click runs it through `keys.ts` `runKey()`), a list on compact
  screens; it takes no focus and no keys. While the prefix is armed the
  Dock, the top bar and the tabs show each control's key (KeyHint.tsx).
- Console auto-hide (`autohide.ts`, described at its top): once per load,
  3 s after the console went quiet following user space's first output,
  the console's window minimizes itself into its Dock tile, so the desktop
  is what the page rests on. Only when that window is as it opened
  (focused, not maximized, snapped or minimized, the console its only tab,
  no other window shown), outside compact mode, with the system running
  and nothing up (launcher, question, prefix, display program, an error
  about the machine); any input on the page before then cancels it, and a
  notice on the console, the machine stopping, safe mode or the base shell
  bring it back. Not on a resumed session. Off with `?autohide=0`,
  Settings > Desktop's "Hide the console after boot" (localStorage
  `kw.hideConsole`, default on), in a browser driven by automation
  (`navigator.webdriver`: the browser tests drive the console),
  `?showcase`, `?verbose=1`, safe mode and `?distro=none`; `?autohide=1`
  turns it on despite the toggle and automation.
- Settings and System (`sysapps.ts`): one window each, their content
  (Settings.tsx, SystemInfo.tsx, in AppShell.tsx's frame: a sidebar of
  sections, or segments on narrow windows, as ARIA tabs) rendered once for
  the page's life through a portal, into the window's body while it is
  open and the hidden `#apps-parked` while not, so their ids (`#opt-*`,
  `#data-status`, `#copy-area`, `#reboot`...) are always in the document.
  Settings: Machine, Distro, Storage (the data disk and its actions),
  Network (Wisp, the preview), Display and sound (and the font size),
  Desktop (DesktopSettings.tsx), Session, Keyboard, About; its footer
  says what changed and has Suspend (`#suspend`, Resume once suspended)
  and Reboot (`#reboot`). System: Overview (a resource monitor: the
  state, CPU, memory, disk, network, GPU with guest GL, Vulkan with guest
  Vulkan, the emulator, the
  busiest processes, the boot timeline with `#stages`, the machine's
  facts; Overview.tsx), Environment (the checks), Kernel log, Errors; its
  footer Copy diagnostics (`#copy`). Each section has a short name (the
  store's `Tab`: boot, distro, storage, ..., about; System's status, env,
  log, errors; guest is an alias of storage), which `openSection()`, the
  tabs' `data-tab` and the tests use.
- Wallpaper (`desktop.ts`, Wallpaper.tsx, Settings > Desktop): kept in
  localStorage `kw.desktop`, applied at once. The default is Random: a
  photo from Lorem Picsum (`picsum.photos`: Unsplash photos, no key, sent
  with CORS, so they load under COEP require-corp) on every load. With
  Random or a chosen photo the page contacts picsum.photos on every load;
  with the built-in wallpaper (style.css: a gradient and the mark) or a
  CSS preset only while Settings > Desktop shows its thumbnails. Requests
  carry no credentials and no referrer. The photo shown last is kept in
  the Cache API (`kw-wallpaper-v1`) as the next load's placeholder, and
  `kw.wallpaper-hint` lets index.html paint it first. The luma of its top
  band, under the top bar, sets `data-wallpaper` (light or dark) for the
  chrome. Photos have Dim and Blur and a credit in the workspace's bottom
  right.
- The bare desktop's menu (`DesktopMenu.tsx`, a right click or a long
  press on `#desktop` or `#workspace` itself): New Terminal, Settings…,
  System…, Change Wallpaper…, Apps….

## Guest GL

The Guest GL option (`?gl=`, the `#opt-gl` box in Settings' Display and
sound; on by default on Debian where the display is: `?gl=0` turns it off, `?display=0` too
unless `?gl=1`; config.ts `glDefault()`, saved only where it differs)
boots with the SDK's `createKernel({ gl: true, gpu: true })` (js.md, Guest
GL, virtio-gpu 3D; gl.md, The DRM path): the guest's Mesa renders through
virglrenderer compiled to wasm on a WebGL2 context of the page's thread (in
worker mode too: vsock and the renderer are served there), through the
virtio-gpu device's `/dev/dri` (stock Mesa, no variables; a KMS client's
frames go to the display from the renderer's texture, `drawFrame()` in
Display.tsx) or the vtest link (frames come back to the guest by readback).
The renderer (`virgl.mjs`, `virgl.wasm`) is fetched and started only on
the guest's first GL use (gl.md, Loading on first use), so a visitor who
never runs a GL program fetches nothing of it; before the boot the SDK
only tries a WebGL2 context (a few ms). `?glload=eager` (this load's URL
only) loads it before the boot (`gl: { eager: true }`). `?gpu=0` (this
load's URL only, like `?glwait=`; also `?display=0`) leaves the device
out, so the guest has the vtest link alone, for comparison.

- Only on Debian (`GL_DISTROS`, config.ts: Alpine's Mesa has no virgl
  driver) and only where `glBlocker()` passes: the page's build has the
  renderer (`glUrl`, above) and the page's thread has `OffscreenCanvas` and
  `WebGL2RenderingContext`. Otherwise the box is unticked and disabled with
  the reason in its note (it follows the Distro radios as chosen), its
  saved value kept; a load that cannot have it boots without and says why
  in the Guest GL row of System's Environment (`cfg.glWhy`: a warning where the
  option was set, `cfg.glAsked`, information where it is the default,
  as on Alpine).
- With GL on the page appends `kw.gl=1` to the command line;
  `/etc/profile.d/kw-gl.sh` (the base's kw layer, kernel/guest.md) then
  exports `GALLIUM_DRIVER=virpipe LIBGL_ALWAYS_SOFTWARE=1` in every login
  and interactive shell (the console, terminal windows, `bash -l`) where
  there is no DRM render node (`?gpu=0`, or a kernel without kwvirtio), so
  a plain `eglinfo` or `glmark2-es2` uses virgl either way; with the
  device `GALLIUM_DRIVER=virpipe LIBGL_ALWAYS_SOFTWARE=1 cmd` runs one
  program on the vtest link. Mesa is not in the image:
  `sudo apt-get install` it (deb.debian.org goes through the page's
  CORS mirror). Programs `vm.exec()` starts without a shell do not get the
  variables.
- `showGl()` (boot.ts): the Guest GL row says "starting", then, once the
  forwarder is linked, "on, not loaded yet" (`vm.gl.status`) until the
  guest's first GL use, "loading" while it loads, then the WebGL2 renderer
  (the unmasked name, `WEBGL_debug_renderer_info`, as the SDK logs it) and
  how long the load took and when (`vm.gl.loaded`, `status.loadMs`), with
  the forwarder links and GL clients (`vm.gl.stats`, every 2 s
  while they change) in its note, and from the renderer's counters
  (`vm.gl.stats.renderer`) where a frame's time went in the renderer over
  the last 2 s with readbacks (`glFrameTimes()`: per readback, time parked
  in busy waits, reading back, issuing GL, uploading; how busy waits were
  answered; gl.md, Stats), and with the device its counters
  (`vm.gl.stats.gpu`, `gpuFrames()`: presents a second and parks over the
  last 2 s, then in all presents, commands, fenced commands parked and the
  time parked, readbacks, errors). `?glwait=strict` passes `gl: { strictWaits:
  true }` (busy waits answered as vtest does) for comparing frame times,
  and the note says so. A software renderer (SwiftShader,
  llvmpipe, WARP...) is a warning row and a toast. The browser console
  gets `[unkernel] guest GL: WebGL2 renderer ...`, the Kernel log the
  SDK's `[host] gl:` lines. No WebGL2 context before the boot is an
  "unavailable" row (information, or a warning and a toast where the
  option was set): the device is 2D and GL programs use llvmpipe. A
  renderer that fails at first use, or a `vm.gl.ready` that rejects
  otherwise (no forwarder in an older bundle), is a failed row and a
  toast, not fatal. A lost WebGL2 context (status "lost", or
  `stats.gpu.contextLost`) is a warning row "WebGL context lost": the GL
  programs that were running fail and must be restarted, the next one
  gets a new renderer, no reload (gl.md, Context loss); "loading" while
  that renderer is made, then the ready row again, whose note counts the
  losses and new renderers.
- A suspended session records GL with the device options (`gl` and `gpu`
  in `SessionDevices`; absent in older records: off), since its kernel's
  command line has `kw.gl=1` or not and its devices differ. It is matched
  with its own GL devices (`sessionDevicesFor()`) and resumed with them
  (`adoptSessionGl()`: `cfg.gl` and `cfg.gpu` become the session's for
  that boot, the row says "off: the resumed session was saved without
  it"), unless this load's URL names `?gl=` or `?gpu=` (then they must
  match) or the session had GL and this load cannot; a resume that fails
  boots fresh with this load's own (`dropSessionGl()`). So a session saved
  before GL was on by default resumes as it was, and a fresh boot uses the
  options. The renderer being loaded or not changes nothing in a session
  (gl.md, Loading on first use). The SDK refuses a snapshot while the
  device holds resources or 3D contexts that submitted commands (a running
  GL program or KMS client; gl.md, The DRM path), before the guest parks, and Suspend then says that a program is
  using the GPU and to quit it (`refusal()`, boot.ts; the same text in
  the auto-suspend and Pause notes). The renderer's state is not saved: a
  resume ends the guest's GL clients, and the forwarder relinks by itself
  (gl.md, unkernel).
- Trying it: `sudo apt-get install mesa-utils libegl-mesa0 libgles2` and
  `eglinfo -B -p gbm` (with the device; `-p surfaceless` either way: the
  GLES renderer must be `virgl (<the WebGL2 renderer>)`); KMS clients on
  the display: `sudo apt-get install kmscube glmark2-es2-drm`, each with a
  stdin that stays open (gl.md, The DRM path: `mkfifo /tmp/h; exec
  3<>/tmp/h; kmscube <&3`, `glmark2-es2-drm --visual-config
  red=8:green=8:blue=8:alpha=0 <&3`); X with glamor on the device: `sudo
  apt-get install xserver-xorg-core xserver-xorg-input-evdev
  libgl1-mesa-dri libglx-mesa0`, then the kw layer's
  `/etc/X11/kw-kms.conf` (kernel/guest.md), `sudo
  Xorg :0 -config kw-kms.conf -nolisten tcp &`, then `DISPLAY=:0
  glxgears`; after the page resized, `xrandr; xrandr --output Virtual-1
  --auto` (x11-xserver-utils; X hears no hotplug without udev; the X +
  glamor app's start.sh, `apps/xkms.ts`, follows by itself: gl.md, Display size). Without the device (`?gpu=0`) X runs on kwfb (kernel/guest.md,
  X.Org on the framebuffer: `xserver-xorg-video-fbdev`, `sudo Xorg :0
  -nolisten tcp &`) and GL clients on it go through the vtest link,
  reading each frame back; for frame rates without the display,
  `sudo apt-get install xvfb xauth glmark2-es2-x11` and `xvfb-run -a -s
  "-screen 0 640x480x24" glmark2-es2`. Installed packages live in Debian's
  upper layer on the data disk (data-disk.md).
- Checked 2026-11-21 with `test/gl/page-check.mjs --suspend` (testing.md):
  the dev server, headless Chromium (Playwright's) on SwiftShader, the
  default URL (GL on by default, no request for the renderer until the
  first GL program; suspend and resume before GL use; Suspend refused
  while kmscube runs; a session saved with `?gl=0` resumed with GL off),
  worker mode, one CPU, `?data=0`, the device (gl.md, The page); and with
  the default CPU count (`--cpus 0`: 4 CPUs here), eglinfo and kmscube on
  the device. Not checked: X on
  kwfb with virgl (`?gpu=0`; a picture on the page's display, its frame
  rate), packages kept across reloads on the
  data disk, the built server's
  `/assets/virgl-*/` files in a browser.

## Guest Vulkan

The Guest Vulkan option (`?vk=`, the `#opt-vk` box in Settings' Display
and sound, under Guest GL; on by default, saved only as `vk=0`) boots with
the SDK's `createKernel({ vk: true })` (vk.md): the base's ICD
(`/usr/lib/kw/libvulkan_kw.so`) talks over vsock port 1018 to a renderer on
the page thread's WebGPU, in worker mode too. Nothing of it (the
renderer's chunks and `kwvk-naga.wasm`) is fetched before the guest's
first VkInstance. Vulkan windows on the Wayland desktop come as external
buffers where the guest's relay has them (Wayland desktop, Vulkan apps by
external buffer), else as wl_shm windows (frames read back).

- Only on Debian (`VK_DISTROS`, config.ts) and where `vkBlocker()` passes:
  the page's build has the translator (`vkShaderUrl`) and the page's
  thread has `navigator.gpu`. Otherwise the box is unticked and disabled
  with the reason, and System's Environment row says why (`cfg.vkWhy`; a
  warning where the option was set). A browser with `navigator.gpu` but
  no adapter (`vkAdapterBlocker()`: `requestAdapter()` gives none, e.g.
  Chrome on Linux without its WebGPU flags; asked once at boot, no device
  made) boots without guest Vulkan the same way: the row and the option's
  note say why and the launcher's Vulkan apps are disabled. Sessions record nothing of it: the
  command line is the same, and the renderer is not in snapshots (a resume
  resets the guest's Vulkan links).
- The translator is picked like the GL renderer (`withVk()` in
  `web/scripts/kernel.ts`): `KW_VK=<dir>` (`KW_VK=0`: none), else with a
  local kernel `vendor/build/vk/kwvk-naga.wasm` (`vk/naga/build.sh`), else
  the release's `kwvk-naga.wasm` asset (the release workflow builds and
  attaches it; `release.json`'s `vk`). The dev server answers
  `/_vk/kwvk-naga.wasm` (`serveGl()`), a build emits
  `/assets/kwvk-naga-<16 hex digits of its sha256>.wasm`;
  `virtual:unkernel-kernel`'s `vkShaderUrl`, which `src/sdk.ts` passes to
  `webPlatform()` with the renderer's modules. The build log's `Vulkan
  translator:` line says which.
- `showVk()` (boot.ts): "on, not loaded yet" (`vm.vk.status` idle),
  "loading", then the WebGPU adapter (`status.adapter`), the load time and
  from `vm.vk.stats` the instances now and in all and, from the current
  renderer's counters (`stats.renderer`) over the last 2 s, frames
  presented a second and draws a frame, its totals, and its errors where
  there are any (a warning row), every 2 s while they change; a software
  adapter (SwiftShader) is a warning row; a lost WebGPU device (status
  "lost", `stats.losses`) a warning row "WebGPU device lost" (the running
  programs must be restarted, the next one gets a new device); a failed
  load a failed row and a toast. Once wland has a link the row also says
  how Vulkan windows reach the page (`KW.wayland.externalBuffers()`):
  "zero-copy presentation" with the external commits, pictures and the
  renderer's `externalPresents`, or "by readback into wl_shm" and why.
- The vkcube app (`apps/gl/vkcube.ts`, Graphics folder; `needs.vk`):
  `libvulkan1 vulkan-tools`, then `vulkaninfo --summary` and `vkcube --wsi
  wayland` on the Wayland desktop. The vkmark app (`apps/gl/vkmark.ts`):
  `vkmark --winsys wayland`. GTK on Vulkan (`apps/gl/gtkvk.ts`):
  `gtk-4-examples`, `GSK_RENDERER=vulkan gtk4-demo`.
- D3D12 gears and D3D12 triangle (`apps/gl/d3d12gears.ts`, described at
  its top, and `d3d12triangle.ts`; Graphics folder, `needs.vk`): vkd3d's
  Direct3D 12 demos, native Linux programs on D3D12 without Wine (vkd3d
  turns D3D12 into Vulkan, kwvk Vulkan into WebGPU). Debian's
  `vkd3d-demos` (vkd3d 1.2: `/usr/bin/vkd3d-gears`, `vkd3d-triangle`;
  with libvkd3d1, libvkd3d-shader1 and libvkd3d-utils1 about 230 kB to
  download, 880 KiB installed) and the Xwayland packages (`xwl.ts`): the
  demos are xcb only, so each runs on a rootful Xwayland of its window's
  size (300x300, 640x480) with no window manager (`XWL_NO_WM=1`), its
  frames read back and put with XPutImage (vk.md, Presentation). The
  gears' X screen is black (`gears.sh`), since the page's window for it
  is 320 wide. vkd3d makes four pipelines at start-up that WebGPU cannot
  run (texel buffers, 1D-array storage images) and the demos never bind:
  kwvk prints a "cannot run on WebGPU" line for each, and the row counts
  them as renderer errors; the README they print first says these are
  expected. Esc quits either, and X with it. Clicked on the dev server on
  2026-11-24 (headless Chromium, SwiftShader, one CPU): on the default
  disk the installer put in vkd3d-demos and the Xwayland packages over
  the page's network and the gears drew about 2 min after the click
  (95 s with vkd3d-demos already on the apps disk), at 28-35 frames a
  second by the row, 6 draws a frame; the triangle's window then came
  within seconds of its click (it presents a few frames, then waits for
  events: no frame rate in the row); both pictures as on lavapipe, no
  device lost.
- The llama.cpp app (`apps/agents/llama.ts`, in the AI folder, described at its top; a Terminal
  window of its own): a language model with every layer on kwvk. The
  installer puts in `libvulkan1 vulkan-tools libgomp1 libssl3t64 curl
  ca-certificates` and fetches the model, stories260K (F32, 1.1 MiB, from
  Hugging Face, which sends CORS headers; `downloads`) into
  `~/.apps/llama/models/`. Its `llama.sh` checks that `vulkaninfo
  --summary` names kwvk, fetches llama.cpp's own release build (Ubuntu,
  arm64, Vulkan; pinned tag and SHA-256, 29 MiB, 77 MiB unpacked into
  `~/.local/share/llama.cpp/<tag>`) itself over https on its first run,
  since github.com sends no CORS headers (Debian 13 has no llama.cpp), and
  runs `llama-completion -ngl 99`: stories without end until Ctrl-C (no
  token limit, the context shifted when full, end-of-text ignored; the
  model has no chat template), `TURNS=1` a story the user continues a
  turn at a time, and a model with a template chats.
  `MODEL=stories15M|PATH|URL` picks another GGUF; quantized ones abort for
  now (vk.md, Unsupported), and wider F32 ones on software WebGPU. Only
  llama's errors and timings reach the terminal (the rest is in
  `llama.log`), and a refused shader or a lost device gets a one-line
  hint. Nothing to deploy for it: both downloads come from their
  upstreams, but the release build's shaders need the translator's
  member-decoration rule (vk.md, Translator), so a page whose
  `kwvk-naga.wasm` predates it loses the device at llama's first submit.
  Driven by a scratch harness on 2026-11-24 (the tile clicked on the dev
  server, headless Chromium on SwiftShader, one CPU, the prepared disk):
  the installer about 1 s (the model; the packages were on the disk), the
  llama.cpp fetch and unpack about 9 s, the first story under 40 s after
  the click; eval 5.1-6.9 tokens/s, prompt 1.1-1.3 (its first batches
  wait for pipelines); a later launch's text after 8-10 s at 5.2-6.1
  tokens/s;
  `MODEL=stories15M` aborted with the hint (rms_norm_mul_f32_512).
- The Ollama app (`apps/agents/ollama.ts`, in the AI folder after
  llama.cpp, described at its top; a Terminal window of its own) runs
  Ollama's server and `ollama run` on kwvk. Ollama 0.40 runs models in
  llama.cpp's llama-server, so its GPU path is ggml-vulkan, as in the
  llama.cpp app. The installer adds `zstd` to llama.cpp's packages and
  fetches the same stories260K into `~/.apps/ollama/models/`. On its first
  run `ollama.sh` checks kwvk as `llama.sh` does, then fetches over https,
  pinned by tag and SHA-256:
  - Ollama's `bin/ollama` (with its Go code's `GO_LICENSE`), from the first
    12 MiB of Ollama's linux-arm64 archive by an HTTP range. The archive is
    1.6 GiB, mostly CUDA, and has no Vulkan backend (Ollama builds that for
    amd64 only).
  - llama-server, libllama and ggml, from llama.cpp's Ubuntu arm64 Vulkan
    build of the tag that Ollama pins (b12651).

  Both go into `~/.local/share/ollama/<version>` (97 MiB; the Vulkan
  backend in `lib/ollama/vulkan/`). The script then starts `ollama serve`
  in its own session (log in `ollama.log`) with these settings:
  - `OLLAMA_IGPU_ENABLE=1`: Ollama drops integrated GPUs, and kwvk is one.
  - `LLAMA_ARG_FIT_TARGET=64`: llama-server's `-fit` keeps 1 GiB of device
    memory free, more than kwvk's heap was (half the guest's RAM then; 4 GiB of device-only memory now), and would
    otherwise put every layer on the CPU.
  - `OLLAMA_NO_CLOUD=1` and `OLLAMA_KEEP_ALIVE=-1`.

  It stops with a message unless three checks pass: Ollama's "inference
  compute" line names kwvk, a Vulkan0 model buffer exists after `ollama
  create` (F32 kept) and a load, and llama-server reports offloaded
  layers. Its "On kwvk" line gives the load time (the load request: the
  weights read and uploaded, the first pipelines made), and `ollama run
  --verbose` ends each reply with Ollama's timings (eval rate: tokens per
  second), the numbers to compare GPUs and builds by. On a terminal ollama.sh asks which model (a numbered list; Enter takes
  the first, SmolLM2 135M, which is also the default without a terminal;
  `MODEL=` skips the question); a model with a chat template gets `ollama
  run`'s chat. `THINK=0` runs a thinking model without its reasoning,
  `TEMP=N` serves a derived model with that temperature, a model that does
  not fit the data disk is refused before its download, and the server is
  started again when Ollama's GPU discovery (30 s) times out on a cold
  start. Short names: `smollm2` (served as `smollm2-tools`: a ChatML
  template with a tool section), `qwen`, `qwen-coder`, `qwen1.5` (Qwen2.5
  1.5B, 2950 MiB), `llama3.2` (1B, 2364 MiB), `qwen3.5` (0.8B, BF16),
  `stories260K`. Models:
  - `MODEL=stories260K`, the story model, runs on software WebGPU too: the
    script writes a story from "Once upon a time" and reads the user's
    story starts, sending each as `ollama run --verbose stories260k
    "TEXT"` (Ollama's generate path), not through `ollama run`'s own
    prompt, which chats through llama-server's chat endpoint with a
    template this model does not know.
  - `MODEL=smollm2` (SmolLM2 135M Instruct, F16, 271 MiB) and the default
    are small coding models for a real GPU. On SwiftShader both abort at
    rms_norm_mul_f32_512 (512-wide workgroups) with the hint; on the
    user's GPU SmolLM2 loaded and answered (2026-11-24). Of the two, only
    Qwen2.5-Coder's template has tools (`ollama show`).
  - `MODEL=[user/]name[:tag]` takes any model of Ollama's registry.
  - `MODEL=PATH.gguf` takes another GGUF. Quantized models abort for now.

  `ollama pull` cannot work in the guest. It refuses redirects to hosts
  that resolve to non-public addresses, and the page's network answers DNS
  with synthetic ones (198.18.0.0/15). So the script fetches registry
  models with curl instead, into Ollama's store as a pull would:
  - The manifest goes byte for byte to
    `manifests/registry.ollama.ai/<namespace>/<name>/<tag>`, a path the
    server reads on each request, so it needs no restart.
  - Each blob goes to `blobs/sha256-<hex>`, checked against its digest and
    resumable.

  The script's exit status says why it stopped: 3 a download failed, 4
  guest Vulkan refused a shader, 5 the WebGPU device was lost, 1 anything
  else.

  `SERVE=1` runs the server only, for other apps. Once the model is on
  kwvk, the script writes its Ollama name to `ollama.ready` and waits;
  Ctrl-C or a TERM stops the server and removes the file. The script never
  sets `OLLAMA_CONTEXT_LENGTH`, so the server inherits it from the caller.
  `ollama.ts` exports `OLLAMA_MODEL`, `OLLAMA_MODEL_CTX` and
  `OLLAMA_MODEL_TOOLS` (stories260k, 2048, false).

  When the script ends it stops the server. A refused shader or a lost
  device gets a hint like llama.sh's. Nothing needs deploying: all
  downloads come from their upstreams. Driven by a scratch harness on
  2026-11-24 (the tile clicked on a dev server of its own, headless
  Chromium on SwiftShader, one CPU, 1 GiB, the prepared disk):
  - The installer took 2 s (the model); the two fetches and unpacking 24 s.
  - The server answered 3 s later. The model was on kwvk ("offloaded 6/6
    layers to GPU", `ollama ps` "100% GPU") 44 s after the click.
  - The first story's eval ran at 2.7-4.8 tokens/s. A typed story start
    ("The little dragon": 8 prompt tokens) ran at 5.1 tokens/s.
  - Ctrl-D ended it with no ollama or llama-server left.
- The fx (local model) app (`apps/agents/fx-local.ts`, in the AI folder
  after fx, described at its top; a Terminal window of its own) runs fx
  against the Ollama app's server as fx's custom connection `local`. It
  repeats nothing of Ollama: it writes the Ollama app's files and
  downloads into `~/.apps/ollama` (shared models, log and `ollama.pid`, so
  one server at a time), installs its packages plus `jq`, and its
  `fx-local.sh` runs `SERVE=1 ./ollama.sh` there in the background with
  `OLLAMA_CONTEXT_LENGTH=CTX`, waits for `ollama.ready`, and stops it when
  fx quits. The connection (protocol `openai-chat-completions`,
  `http://127.0.0.1:11434/v1`, auth none, long `timeouts`, and
  `model_metadata` with `context_window`, `max_output_tokens`,
  `supports_tool_use` and `supports_vision`) is merged with jq into an
  app-private `FX_HOME` (`~/.apps/fx-local/fx-home/settings.json`), so the
  user's `~/.fx` is untouched; fx runs with `FX_PROVIDER=local`,
  `FX_MODEL` and `FX_AUTO_UPGRADE=0` in `~/.apps/fx-local/work`. fx-local.sh
  asks which model on a terminal as ollama.sh does, runs it at temperature
  0 (`TEMP=`) and a thinking model with `reasoning_effort: "none"` in the
  connection's per-model request fields (`THINK=1` for thinking; untested
  in fx). The
  first and default model is `MODEL=qwen` (Qwen2.5 0.5B Instruct,
  `qwen2.5:0.5b-instruct-fp16`: the smallest one ollama.sh offers that
  calls fx's tools; CTX 16384; guest memory 3 GiB or more). Qwen2.5-Coder
  0.5B (`MODEL=qwen-coder`, the same size) answered fx with JSON in a code
  block instead of tool calls (3 tasks of 3; Qwen2.5 0.5B called tools in
  2; host CPU, 2026-11-24). fx sends
  its tools with every request whatever `supports_tool_use` says, and
  Ollama answers HTTP 400 for a model without them (SmolLM2, the story
  model), so fx-local.sh stops before fx with such a model. The
  `context_window` never exceeds the trained context that Ollama's
  `/api/show` reports, and tool use follows its capabilities
  (`OLLAMA_MODEL_TOOLS` for the story model; `TOOLS=0|1` overrides). On
  a real GPU (the user's, 2026-11-24) SmolLM2 loaded and fx reached it
  (and got that 400); Qwen2.5 with fx on a GPU is untried. The field names
  follow fx's docs for 0.0.17.
- The page needs a base bundle with the ICD (vk.md). `test/vk/page-check.mjs`:
  the dev server on a free port with `KW_KERNEL=$KW_BUILD/vk/base/unkernel.wasm`
  where it exists (`--kernel FILE`; `--built`: web/.output, whose kernel
  the build took), the Playwright Chromium with the WebGPU flags (vk.md,
  Testing), the prepared disk `$KW_BUILD/vk/debian-vk.img` imported (as the
  `.kwsparse.gz` next to it, made once; `--fresh`: apt instead), the
  default URL; checks the option on by default with the renderer idle and
  nothing fetched, `vulkaninfo --summary` naming kwvk, the row naming the
  adapter, the vkcube tile's window and its pixels and the row's frame
  rate, how vkcube's frames came (external buffers with no byte read back
  where the guest's relay has `--external-buffers`, `--relay FILE`
  pushing an aarch64 wlandr over the image's and restarting the boot's
  relay; else readback), then the vkmark and GTK on Vulkan tiles' windows where the disk
  has them (`--disk $KW_BUILD/vk/debian-vk-apps.img`, debian-disk.mjs
  --apps; `--no-vkmark`, `--no-gtk`), then the D3D12 gears and triangle
  tiles' Xwayland windows where the disk has vkd3d-demos or with
  `--vkd3d` (their installer then installs it over the page's network;
  `--no-vkd3d`): pixels, the gears' change between two screenshots 1 s
  apart, the row's frame rate printed (`--no-tile`, `--inline`,
  `--shots DIR`). A reload of the page during the checks (the
  dev server reloads it when a source in the tree changes, which ends the
  VM) makes the run "could not run" (exit 2), not a failure.
- Checked 2026-11-24 with `test/vk/page-check.mjs`, one CPU, a base built
  with the ICD (Vulkan 1.2; `KW_BASE_OUT` and `kernel/tools/bundle.mjs`,
  with the SMP patch): worker mode and `--inline` with `--disk
  debian-vk-apps.img` pass (vulkaninfo apiVersion 1.2.314; the translator
  loaded in about 30 ms on "google swiftshader"; vkcube 500x500 at 34-45
  frames a second by the row, 1 draw a frame; vkmark's window 800x600 and
  gtk4-demo's 828x598 with GTK's Vulkan renderer drawing, non-blank); and
  `--built` (that base as the local bundle, the default disk). Two earlier
  `--inline` failures came from the dev server reloading the page for
  another session's edit of `js/core/vk-host.ts`. The built server sends
  the translator as `application/wasm`, br-compressed, immutable. Also
  2026-11-24, the default disk, the image's relay (wland
  0.1.0-261124-3c987e5): worker mode and `--inline`, vkcube by external
  buffers (every present an external commit resolved to a picture, 0 bytes
  read back; resolve 0.13 ms; 32 frames a second by the row); with a relay
  without external buffers, by readback (1 MB a frame).

## Wayland desktop

Wayland apps in the guest show as windows on the page, through
[wland](https://github.com/pithings/wland) (npm `wland`, pinned exactly
in `web/package.json`; `src/wayland.ts`, `src/wayland/`,
`components/WaylandOutput.tsx`): its
compositor (wasm) runs on the page's thread, its relay in the guest. The
page boots with `createKernel({ shm: true })` (kwshm; js.md, shm) and
`kw.wayland=1` on the command line (with kwshm only, as `kw.gl=1` with
GL; a resume keeps the saved kernel's command line) and, once the kernel
runs, listens on vsock port 1023 (`WAYLAND_PORT`). Wayland is always
there in a Debian guest (its image carries the relay, kernel/guest.md;
Alpine and the base shell have none, so nothing starts and `wland` says
why; with a relay that has `--link-on-demand`: wland after the pinned
release, below): with `kw.wayland=1` the kw layer's rc starts the relay
`/usr/lib/kw/wlandr --link vsock:2:1023 --buffers kwshm --link-on-demand`
for the image's user (with `--dmabuf virtgpu:/dev/dri/renderD128
--no-fence-wait` where guest GL's render node is: GL apps, below), which
binds `/run/user/UID/wayland-0` and dials the page only when an app
connects, and every login and interactive shell has the variables that
make toolkits pick Wayland (`WAYLAND_DISPLAY`, `XDG_SESSION_TYPE=wayland`
and the rest; Debian's chromium gets `--ozone-platform=wayland`), so
`foot` started plainly maps a window (kernel/guest.md, the kw layer).
`wland CMD` (`/usr/lib/kw/bin/wland`) still works: it starts a relay
where none runs (killed, or a relay without `--link-on-demand`, which
the boot leaves out: it would dial at once and load wland at every page
boot) and runs CMD in the session. The relay tells its features with
`wlandr --version` (a `features:` line; a relay without it, the pinned
release, is read from `--help`). The apps' buffers stay in guest memory: the
relay exports each through `/dev/kwshm` and the compositor reads it in
place wherever `ShmFile.inPlace` (inline, and worker mode on several CPUs:
the SMP kernel's memory is shared with the page, js.md, shm): wland takes
the export's page runs (its `view`: `ShmFile.views()`, no copy of ours; a
single run is presented as it is, several have the damaged spans
gathered). Else (one CPU in worker mode) every damaged span of a commit
goes in one `readv`, a `ShmFile.read()` each, posted together through the
shared transport's ring and served at the kernel's next clock read (about
0.6 ms), and with `?shared=0` (or no cross-origin isolation) as messages
answered at the kernel's next yield.

- Loaded on first use: the relay's first connection (at the first app)
  imports wland (its own chunk) and `wland.wasm` (passed by URL:
  `wland/wland.wasm?url`, since the dev server's dep optimizer breaks the
  package's own `import.meta.url` lookup); a page that never runs a
  Wayland app fetches neither. After a change of wland's version restart
  the dev server: its pre-bundled `wland/client` otherwise stays the old
  one next to the new `wland.wasm`, wland fails to load with a LinkError
  and every Wayland client is refused (the reason is only in the Kernel
  log). The relay's next connection after a drop
  goes to the same wland (a fresh compositor; the apps of the old link are
  gone). The relay counts a completed connect as the compositor attached
  and the SDK's listener completes every connect, so the page takes a
  connection only where wland serves it: one at a time (a second
  relay's is reset, its apps fail at once instead of waiting), none once
  wland failed to load (the listener closes, so dials are refused), and
  one that went away before wland took it (a dial that timed out while
  wland loaded) is skipped. After the last window the link stays up and
  wland loaded: closing it frees only the compositor's state (the module
  stays) and races an app connecting meanwhile.
- Costs when unused (2026-11-22): the relay's RSS 904 to 908 KiB, its
  start at boot about 35 ms of guest time (`wland --boot` 0.11 s against
  0.08 s for `sudo true`, Node CLI; whole boots to a prompt 1.05 s
  without, 1.09 s with the flag, within the noise), nothing fetched and no
  compositor until the first app (`page-check.mjs`, "idle before an
  app"). Plain foot maps 1.1 to 1.2 s after its start in a fresh page,
  wland's chunks and wasm fetched 0.3 s after it.
- Failure: outside the page (the Node CLI, which never adds the flag) no
  relay starts and shells get no session: `foot` fails at once as on any
  machine without a compositor (`failed to connect to wayland`). Where
  the relay runs but nothing takes its dial (the CLI with `--shm` and
  `wland`, an app before the page listens) the app fails within 0.3 s:
  the host refuses the connect, the relay closes the waiting app and logs
  `wayland client refused: no engine on link vsock:2:1023
  (ConnectionRefused)`; foot prints `no compositor` and `failed to flush
  wayland socket` (exit 230), and `wland CMD` adds that the page did not
  take the link.
- Windows (`wayland/host.ts`, described at its top): each toplevel is a
  window of the page's window manager (wm.ts, `wl-<key>`, in the z-order
  the terminals and the other windows share), wland's window element (its
  canvases) at the window's body's origin. createWland runs as an
  embedder's window manager wants it: `decorations: 'server'`,
  `autoFocus: false`, `manageDisplay: false`, and the `mount`, `unmount`
  and `interactive` hooks. wland answers xdg-decoration with server-side:
  apps that ask (foot; SDL, through libdecor) are `decorated` and get the
  page's frame (frame "normal": the title bar with minimize, maximize and
  close), the others (GTK) draw their own title bars (frame "none": no
  border, background or shadow, style.css); a change after the window
  maps (the `decoration` event) adds or drops the frame, the element
  keeping its size. Nothing clips a Wayland window, so the app's shadows
  and popups reach past it. The WM owns the position and the z-order, the
  app its size: the element's size (the window geometry wland applies)
  is copied into the WM window, plus the frame, and a size the WM gives
  it (an edge drag, the workspace shrinking) is asked of the app
  (`requestResize`). Each such request's token is matched to the app's
  ack of the configure it caused (or of a later one); until then the
  sizes the app commits are not taken, so a stale answer never wins over
  a newer request. Maximized, a window fills what `setBounds()` gave
  wland: the workspace, less the title bar for a decorated window;
  compact mode (wm.ts) configures every Wayland window maximized, and a
  fullscreen app maximizes its WM window while it lasts.
- Moves, resizes, tiles: xdg_toplevel.move and resize (a press on a GTK
  app's own title bar or border) and Alt+drag reach the page through
  `interactive` and become the WM's own move or resize, the pointer
  grabbed from the apps meanwhile. wland's window manager keeps popup
  grabs, drag and drop and Alt+F9/F10/F11 (minimize, maximize,
  fullscreen), whose states the WM window mirrors (and the reverse:
  minimize and maximize from the page reach the app). Snapped to a tile
  (a drag to the workspace's edge, Ctrl-A and an arrow), the app is told
  it is tiled on the tile's outer sides, with the tile's size
  (`setTiled`; no edges once it leaves the tile), and the size it takes
  is drawn against the tile's outer side and corner (`wm.fitTile`).
  Where each element is in the workspace (wland's output) goes to wland
  after each change of the WM (`setWindowPosition`), so popups (menus,
  tooltips) near the output's edges flip or slide to stay on it.
- Close: the title bar's button, Close Window in the Dock's and the top
  bar's menus, and the compact strip's button send xdg_toplevel.close:
  the app decides (it may ask first, or ignore it), and the WM window
  goes when the toplevel unmaps.
- Focus: the WM's focus is the authority (`autoFocus: false`). A Wayland
  window focused (a press in it, its Dock tile, Ctrl-A w) is raised in
  wland and gets its keyboard (`input.focus`: wland's hidden editable
  sink); any other window focused takes it away (`input.blur`), so keys
  typed in a terminal never reach an app and the reverse, and a press in
  the focused Wayland window whose keyboard went (the page's focus taken
  outside the windows) gives it back before the app sees the press. A
  window maps focused unless it maps minimized. display.ts takes keys only
  while the Display window has the WM's focus, and the terminals ignore
  wland's elements (termtabs.ts); the page's shortcuts (Ctrl-A) still
  come first, and Ctrl-A Ctrl-A sends Ctrl-A on to the app. Ctrl-A w and
  the Dock's `#dock-wayland` (there while the relay is connected: the
  store's `wayland.attached`) go to the top Wayland window (restoring the
  top one when all are minimized), or, from a focused one, back to the
  top other window (winmenu.tsx `toggleWayland()`). wland's container
  `#wl-desktop` (`components/WaylandOutput.tsx`) covers the workspace,
  over every window, and takes no pointer: the output the apps get (what
  maximize and fullscreen fill), with the keyboard sink, drag icons and
  the cursor image in it; `data-shown` while a Wayland window has the
  focus.
- Minimized and hidden: minimized follows both ways (the Dock, the title
  bar, Alt+F9, the app). wland leaves the window elements displayed
  (`manageDisplay: false`), so a minimized window flies into the Dock with
  its last frame (wmfx.ts), and a window the WM does not show (minimized;
  in compact mode, any but the top one) is not rendered for (`setVisible`,
  from the WM window's `onVisible`).
- What the Dock and the top bar show of a window: its tile
  (`#dock-wl-<key>`) and the top bar's detail are labelled with the app's
  title (else its launcher app's name, its app id, "Wayland window"). By
  its app id (xdg_toplevel.set_app_id): a launcher app's (appwindows.ts
  `waylandApp()`: the app's id or one of its `waylandIds`, any case, or
  the last part of a reverse-DNS id; foot, thunar, chromium, the games)
  gives the window that app's descriptor, so it is drawn as the app's
  pinned tile (its running dot; a click shows it) or with its icon, and
  gets Keep in Dock; any other app id gets the guest's own icon for it
  (`wayland/icons.ts` `guestIcon()`, described at its top: the app id's
  .desktop file and its `Icon=` in the hicolor and Adwaita themes or
  `/usr/share/pixmaps`, one `vm.exec()` per app id, never while the
  machine is held, only an SVG or PNG of at most 256 KiB, kept for the
  page's life), the generic icon while it is read, the app id's letter
  when the guest has none, the generic icon without an app id.
- The clipboard works between the apps (wl-copy, foot, GTK), and wland's
  bridge (its `clipboard` option, left on) joins it to the page's for
  plain text: a paste chord while a Wayland window has the keyboard
  (Ctrl+V, Ctrl+Shift+V, Shift+Insert) gives the focused app the page
  clipboard's text (from the browser's paste event), and an app's copy is
  written to the page clipboard around a click or key in a Wayland
  window. On because it asks for
  no permission: it reads the page clipboard only from a paste event (or
  on focus where clipboard-read was granted already) and writes only
  around a gesture, so no browser prompts; a relay without the bridge
  (0.1.0) turns it off for its link. Pasted HTML, images and files are
  `wayland/paste.ts` (described at its top), which takes those paste
  events before wland and sets the Wayland selection itself; host to
  guest only. A page cannot put files on the host clipboard, so files
  copied in an app show a toast that saves them through the browser
  (`wayland/copyout.ts`; a folder or several as a .tar.gz), and their
  paths are kept off the host clipboard (the bridge clears it instead).
- Drags from the host (`drop.ts`, described at its top): files dropped on
  an app go into the guest's `~/Downloads` (`upload.ts`; a name taken
  gets " (2)") and reach it as text/uri-list, dragged text, HTML and
  links as they are. createWland's own bridge is off (`dnd: false`): it
  asks its container what is inside, and the apps' elements are not in
  `#wl-desktop`. On a terminal whose shell is at its prompt they go into
  the shell's directory instead (`promptDir()`); where a program runs,
  it gets their quoted paths. A drop elsewhere on the page only copies.
  Every other drop is cancelled, since the browser would open it over
  the machine. Folders are not copied.
- Sessions: kwshm is a device of the snapshot, so a session records it
  (`SessionDevices.shm`; absent in older ones: off) and resumes with its
  own (`adoptSessionGl()`); a fresh boot has it unless `?shm=0` (this
  load only, config.ts), which boots without it as the page did before
  the desktop. Without kwshm the page does not listen, the foot tile is
  dimmed with why, and `wland` says there is no `/dev/kwshm`; no
  `kw.wayland=1`, so no relay at boot. A resume resets vsock: the
  relay's apps of the old link are gone and it dials again at the next
  app (`link ... closed; dialing again for the next app`); the resumed
  page fetches nothing of wland until then. A session saved before the
  relay started at boot resumes as it was (its relay, started by `wland`,
  dials at once and the page loads wland).
- **GL apps by GPU resource** (`gpuSource()`): with guest GL's virtio-gpu
  device (gl.md, The DRM path) the relay starts with
  `--dmabuf virtgpu:/dev/dri/renderD128` where that node exists and the
  relay has the mode (`dmabuf:virtgpu` in `--version`, else its `--help`;
  0.1.0 has not), with `--no-fence-wait` where it has that, and the page gives
  wland a `gpu` source where `vm.gl.gpu` exists (the `gl` and `gpu`
  options, WebGL2), unless `?wlgpu=0` (this load only, config.ts). wland
  then offers linux-dmabuf v4 (AR24, XR24, AB24, XB24, each with the
  implicit modifier and LINEAR), the relay names each GL client buffer by
  its virtio-gpu resource, and `resolve()` is `vm.gl.gpu.image(resource,
  { width, height, opaque: XR24 or XB24, flipY: y_invert })`: an
  ImageBitmap blitted in the renderer's WebGL2 context, no readback (a
  promise only while the renderer loads; a buffer at a plane offset gives
  null, logged once), which wland draws into the window's canvas and
  `release` closes. After a lost WebGL2 context `image()` gives null for
  the buffers of the GL clients that ran then (restart them); the relay's
  own context never submitted, so the new renderer makes it again, and GL
  clients started after the loss show (gl.md, Context loss). Without the source wland leaves linux-dmabuf out, also
  in front of a relay with `--dmabuf`, and GL apps render in software
  (llvmpipe) into wl_shm buffers like any app: GL off (no render node, no
  flag), `?gpu=0` (the vtest link: with `GALLIUM_DRIVER=virpipe
  LIBGL_ALWAYS_SOFTWARE=1` Mesa's software winsys shows virpipe's frames
  in wl_shm buffers), a 2D device (no WebGL2 at boot: the node and the
  flag are there, the source is not), `?wlgpu=0`. A relay started without
  the flag (a session resumed from a boot without the node) keeps GL apps
  in software; `wland` says so and that `pkill -x wlandr` (which ends its
  apps) lets the next `wland` start one with it.
- Ordering: in both modes a GL client's SUBMIT_3D reaches the renderer
  before the relay's commit naming its buffer reaches wland (in worker
  mode virtio-gpu requests and vsock packets share the worker's one
  message channel to the page, which runs a submit as it arrives), so the
  blit sees the frame. So the relay runs with `--no-fence-wait` where it
  has it; a relay without (the pinned release) waits up to 100 ms per
  commit for the dmabuf's write fence (signalled once the device answered
  the submit), which only adds latency, and logs `still being written
  after 100 ms` once per connection at GTK 4's first frame (shader
  compiles on SwiftShader); the window is right either way. An on-demand
  relay started without its render node warns (`linux-dmabuf off for
  now`) and looks the node up again at each dial (page-check `--gpu`).
- **Vulkan apps by external buffer** (`gpuSource()`'s `resolveExternal`,
  where `vm.vk` exists, unless `?wlgpu=0`): the guest's `wland` launcher
  starts the relay with `--external-buffers` where its `--version` lists
  `external-buffers` (the pinned release's relay does not: Vulkan windows
  then come by readback), and wland then offers
  `wland_external_buffer_manager_v1`; the kw ICD names each swapchain image
  by an id instead of sending its pixels (vk.md, Presentation), and
  `resolveExternal()` is `vm.vk.externalImage(ref)`: an ImageBitmap copied
  from the image's GPUTexture on the Vulkan renderer's device, synchronous
  (a promise would stall every window of the link), null for an id no
  running program made (the window keeps its last content); `release`
  closes it, for both kinds. `KW.wayland.externalBuffers()` is wland's
  `engine.externalBuffers()`; `KW.wayland.stats()` counts `extCommits`,
  `extImages`, `extMs`, `extMaxMs`, `extDrawMs`; the Guest Vulkan row says
  which way Vulkan windows come. A relay started without the flag (an
  older image, a resumed session's) keeps them on readback.
- What Mesa picks (Debian 13, Mesa 25.0.7; 2026-11-22): EGL's Wayland
  platform on the `virtio_gpu` DRI driver, window configs in B8G8R8A8 and
  B8G8R8X8 only (no R8G8B8A8 one), so ARGB8888 with alpha and XRGB8888
  without, always with the LINEAR modifier (0), never y_invert, plane
  offset 0, stride width x 4. GTK 4.18 draws with GskGLRenderer (its default;
  `GSK_RENDERER=vulkan` uses guest Vulkan, vk.md), which needed renderer
  patch 14 (gl.md, Patches).
- One wland release on both sides: the npm version in `web/package.json`
  and the relay's `WLANDR_VERSION` (guest/distro/debian/pins.sh) change
  together (the link protocol is theirs). The relay comes with the Debian
  image, so it matches the page only where the image is the same
  release's (the page's own images are); nothing checks the link's
  version, and `wland` reads only the relay's features for its own flags. The page needs wland
  0.1.0-261122-6617578 or later (createWland's embedder
  options and hooks, `setBounds`, `setTiled`, `setVisible`,
  `setWindowPosition`, besides the `gpu` source, `view`, `readv` and the
  clipboard bridge); older packages lack that API. The
  relay asset is `wlandr-link-linux-arm64.tar.gz` (the `--link`-only
  build, its entry `wlandr`). The relay at boot needs `--link-on-demand`
  (and `--version`, `--no-fence-wait`), and Firefox's input the core that
  sends seat events to every pointer and keyboard of a client: both in
  wland 0.1.0-261122-632f589. Both pins are 0.1.0-261124-3c987e5. With an older relay the boot
  starts none and shells get no session (plain apps fail as outside the
  page; `wland CMD` works as before). A new release: `WLANDR_VERSION` and
  `WLANDR_SHA256` in pins.sh and the npm version in `web/package.json`
  (and the lockfile), then `kernel/build.sh distro debian`
  without `KW_WLANDR`. To try a local wland build:
  `KW_WLANDR=<wland>/zig-out/release/wlandr-link-linux-arm64 kernel/build.sh
  distro debian` (guest/distro/debian/build.sh; refused with
  `KW_RELEASE=1`), and for the
  page a build against that checkout's package: copy its `package.json`,
  `LICENSE`, `README.md` and `dist/` to a directory of their own, then
  `KW_WLAND_PKG=<dir> node node_modules/vite/bin/vite.js build` in `web/`
  (`unkernel:wland-pkg` in vite.config.ts resolves `wland` and its
  subpaths through that package's exports; build only) writes
  `web/.wland-local/output/`, and `node test/wland/page-check.mjs --output
  web/.wland-local/output` (any case) or `PORT=<port> node
  web/.wland-local/output/server/index.mjs` runs it. It leaves
  `web/node_modules` (Nitro's `last-build.json` is put back), `web/.output`
  and a running dev server alone: never replace `web/node_modules/wland`,
  a pnpm store link (a swapped package broke a running dev server's page).
- The launcher's foot app (`apps/gl/foot.ts`, Debian: foot,
  fonts-dejavu-core, fontconfig; `needs.wayland`: dimmed without the
  desktop) runs plain `foot` (the session is in every shell, the relay
  runs from boot); its README suggests wl-clipboard, wayland-info and a
  GTK 3 app (l3afpad). The GL windows app (`apps/gl/wlgl.ts`, Debian:
  mesa-utils; `needs.wayland`) runs `es2gears_wayland` after `eglinfo -B
  -p wayland`; its README suggests glmark2-es2-wayland and
  gtk4-widget-factory (GTK 4). Other Wayland apps are in the Browsers,
  Desktop and Games groups: SDL games (what they share: `apps/sdlwl.ts`), X11 apps in
  one rootful Xwayland window with twm (`apps/xwl.ts`). Started from the
  launcher, a Wayland app's terminal is its log (`launcher.ts`): its tab
  opens selected, as any app's, and shows until the app's window maps and
  takes the focus (with `terminal: "window"` its own Terminal window is
  minimized at once instead); it closes when run.sh ends with status 0
  and stays after a failure. While a launcher app's window is open the
  app's tile stands for that window, not for the terminal.
- `KW.wayland`: `windows()` (key, title, appId, decorated, focused,
  maximized, fullscreen, minimized), `container()` (the workspace,
  `#workspace`, which holds the window elements and `#wl-desktop`),
  `loaded()`, `popups()` (how many are mapped now) and `popupKeys()`
  (their canvases' `data-wland`), `stats()` (buffer handles opened; reads, how many in
  place and of those views, bytes, the reads' total and longest time;
  commits; GPU commits, images, waits for the renderer, image()'s total
  and longest time, and resolve to release, which includes wland's draw),
  `gpuLast()` (the last GPU buffer a commit named), `log()` (wland's
  last 500 wire-level lines: the apps' decoded requests), `wland()`
  (wland itself, for debugging).
- Frame pacing (2026-11-22, `page-check.mjs --built --pacing`, headless
  Chromium at 61 rAF/s, worker mode): weston-simple-shm (250x250, redraws
  everything) 60 commits/s on 1 CPU (readv through the ring, 0.25 ms) and
  on 4 (in place, 0.01 ms); inline 60 (0.01 ms). foot under `yes` output
  (696x468, 116x36 cells of DejaVu Sans Mono 8 pt) redraws its whole
  window each commit (1272 KiB: more than a screenful arrives between
  frames, so every row is dirty): 13.5 to 14.8 commits/s on 1 CPU (reads
  0.9 ms, 1% of the time; 12.0 to 12.5 while the page's vsock packets
  went as messages, below), 19 on 4, 11 to 15 inline (repeated runs).
  Where a frame goes (2026-11-22, one CPU, worker mode, timestamps at
  each hop: the packets in the worker's VsockDevice and the page's
  VsockHost, wland's commit event, rAF, and foot's `WAYLAND_DEBUG` and an
  LD_PRELOAD shim on its reads, the guest's clock aligned to the page's
  within about 2 ms): foot's commit to the relay's packet leaving the
  guest 1 to 3 ms, to the page 0.1 to 0.2 ms (posted at the kernel's next
  task switch), to wland's commit event 1.5 ms (the readv), to the frame
  callback at the next rAF 0 to 16 ms (8 on average: wland answers at the
  first rAF after it presents, as it should), into the guest 0.2 ms (the
  shared transport's vsock ring; as messages 0.6 to 20 ms, 12 on average,
  waiting for the kernel's yield), the guest takes it within 0.3 ms; then
  about 25 ms until foot reads its Wayland socket and 30 to 40 ms to its
  next commit. That last part is foot: between commits it reads the pty
  in 4 KiB pieces, each parsed in about 1.4 ms here, up to ten per pass of
  its event loop, and handles the Wayland socket after them, so the frame
  callback waits one or two such passes (`nice -n 19 foot` changes
  nothing). weston-simple-shm next to a `yes > /dev/null` keeps 60
  commits/s (49 while the packets went as messages). Inline the page runs
  only at the kernel's 20 ms yields (about 48 rAF/s under foot's load),
  and the packets need no crossing. The page's counters are every
  window's: the pacing check fails while another window is open (60 to 75
  commits/s at about 430 KiB measured once for foot were 13 of foot's
  plus about 47 of a weston-simple-shm that the cleanup had missed;
  both together give 61 at 429 KiB). With `?shared=0` each read is a
  message that waits for the kernel's next yield, as are the vsock
  packets: a read about 11 ms under foot's load, foot 10 commits/s
  instead of 13.5 to 14.8; weston-simple-shm keeps 60
  (0.22 ms: the idle kernel yields soon). wland processes nothing else
  while a read is pending (a synchronous read never leaves one pending).
  Not taken: the engine in
  the kernel's worker, an early yield on request (a kernel change), the
  SMP kernel on one CPU (js.md, Worker mode).
- wland issues: the two seen with 0.1.0 and reported upstream are fixed in
  the release after it (checked with the local build, 2026-11-22): a GTK
  window's popups (l3afpad's context menu) open at the pointer (the menu
  1 px right of and below the click; it was about 20 px up and left), and
  a quick click on foot's resize border (its request comes after the
  release) no longer starts a resize that follows the pointer (a drag on
  the border resizes by the drag, foot rounding to whole cells).
- Not wland's: l3afpad (GTK 3) ignored a right click in its text about
  every other time (2026-11-22: 6 of 12 and 4 of 6 attempts, its menu
  never came) when the left click before it had its press and release
  sent back to back, as the DevTools protocol does: both reach the app in
  one read, and l3afpad's own `button-press-event` handler (`view.c`,
  `cb_button_press_event`) calls `gtk_clipboard_wait_for_text(PRIMARY)`,
  a nested main loop, which dispatches the release before GtkTextView's
  gestures have seen the press (traced with an LD_PRELOAD shim on GTK's
  calls into GLib and GDK). Those gestures stay pressed, and the next
  right press goes to cancelling them instead of the context menu. With
  the button held 60 ms, as a hand does, 14 of 14 menus opened, and 10 of
  10 with clicks held 80 ms while `yes` kept the guest's CPU busy, so
  people do not meet it unless the app is too busy to read the press
  before the release arrives. page-check's clicks hold the button 60 ms
  (`holdMs`). The strip GTK redraws at the window's right edge after the
  pointer moves is its overlay scrollbar fading in and out (about a
  second).
- Checked 2026-11-22 with `test/wland/page-check.mjs` (testing.md): the
  dev server and the built page, headless Chromium (Playwright's) on
  SwiftShader (wland's 2D path: it uses WebGL only on hardware), the
  prepared disk imported into the fresh profile's data disk, worker mode
  on 1 CPU and on 4, and inline: nothing of wland fetched before the tile
  (its chunk nor its wasm), foot's window mapped about 1 s after the click
  (33 s from a fresh Debian, apt over the page's network), its pixels on
  the page, typed keys reached its shell and not the terminal, `exit`
  closed its window and the focus left it, the relay ran on, a second `wland` reused
  it, a killed relay was replaced by the next `wland foot`; two foot
  windows (focus by click, keys to the focused one, closing one gives the
  other the keyboard), Alt+F10 and the page resized while maximized,
  Alt+drag, the clipboard from wl-copy to foot and from foot to wl-paste;
  l3afpad (GTK 3): typing, its context menu (a popup) and Escape, Ctrl-A
  Ctrl-A then Ctrl+C to wl-paste; foot's keys (Ctrl-C, Up, Left, Alt+.,
  Ctrl-U, auto-repeat: 24 x for a 1.13 s hold, Ctrl-A Ctrl-A), Ctrl-A w
  both ways, with the focus following;
  Suspend with foot open (worker mode) and a plain load resumed, the relay
  reconnected, a new foot mapped; a session saved with `?shm=0` resumed
  without kwshm and the next boot had it. Again with wland's release
  after 0.1.0 (the local build, `--built`, worker mode on 1 CPU and
  inline): all of that, plus the bridge to the page's clipboard both ways,
  the two fixes above and edge resizing by drag; and `--gpu` (worker mode
  on 1 CPU and inline; on 4 CPUs the pacing run): the relay
  with `--dmabuf virtgpu`, linux-dmabuf v4 offered, the renderer loaded on
  the first GL frame (not before), weston-simple-egl by resource (no shm
  reads) with its translucent background kept (alpha 128) and the right
  way up, `-o` opaque, a stopped client's window equal pixel for pixel to
  its last resource's picture taken afresh, foot and a GL window updating
  together, gtk4-widget-factory (GskGLRenderer) with no renderer errors,
  a relay without `--dmabuf` (wland's note; GL apps in shm windows),
  the GL windows tile (es2gears by resource), Suspend refused while
  es2gears ran and done after, es2gears by resource
  after the resume, `?wlgpu=0` (linux-dmabuf not offered although the
  relay has `--dmabuf`; llvmpipe frames in shm windows) and `?gpu=0`
  (virpipe frames over the vtest link in shm windows). Not checked: real
  GPUs (wland's WebGL path; the GPU path's cost there), Safari,
  phones (touch, the on-screen keyboard), the guest's Display window next
  to Wayland windows. By hand on the page (2026-11-22, wland
  0.1.0-261122-6617578, the embedder API above): it runs, and foot's
  window has the page's frame.
- Firefox (Debian's firefox-esr 153, 2026-11-22, headless Chromium,
  worker mode on 4 CPUs, `debian-disk.mjs --firefox`): WebRender on
  virgl, its window by GPU resource (ARGB8888, one buffer reused, as wland
  releases it after the image), renders a page since renderer patch 15
  (gl.md, Patches; before, the window stayed fully transparent and the
  guest's kernel flooded with failed transfers). 512
  MiB is too little: the guest thrashes (about 20 MiB left, half the CPU
  time in I/O wait) and the first page takes minutes; with 2 GiB (the
  page's default on desktops) its window maps in about 45 to 65 s (a new
  profile; 24 s for the next start in the same boot). Its input
  needs wland 0.1.0-261122-632f589 or later; before it Firefox took none,
  on the GPU path and in software alike: wland
  0.1.0-261122-f36330a kept one wl_pointer and one wl_keyboard per client (the
  last made; `pointer_id`, `keyboard_id` in its compositor.zig), while
  Firefox binds wl_seat twice (GTK's at v5, then its own at v8 for serials
  and pointer constraints), so the events go to Firefox's own objects and
  GTK's get none (seen with WAYLAND_DEBUG: `wl_pointer#36.button`,
  `wl_keyboard#37.key`, nothing for GTK's `wl_pointer#8`,
  `wl_keyboard#19`). wland now sends each seat event
  to every pointer, keyboard, relative pointer and data and
  primary-selection device of a client (WAYLAND_DEBUG: `wl_pointer#8` and
  `#36` both get the motion, button and frame, one enter serial for
  both), and Firefox takes
  clicks, typing, Ctrl+L and a typed URL, its context menu (a click on an
  item, Escape), the wheel, a drag selection (the primary selection) and
  Ctrl+C and Ctrl+V with wl-copy and wl-paste, on the GPU path and with
  `?wlgpu=0` (`page-check.mjs --firefox`). Ctrl+A is the page's prefix
  there as everywhere (Ctrl-A Ctrl-A sends it on). Guest memory with
  Firefox on a page: 730 MiB used of 1978, its processes' RSS 1.4 GiB
  (shared pages counted in each).
- Chromium (Debian's chromium 156, 2026-11-22, headless Chromium on
  SwiftShader, worker mode on 4 CPUs, 2 GiB): renders on the GPU path,
  its window by GPU resource (ABGR8888), with two conditions. Mesa's EGL
  must be installed: the package's recommends bring the DRI driver, GBM
  and GLX but not `libegl1` and `libegl-mesa0`, which its ANGLE loads
  as `libEGL.so.1` (without them the GPU process cannot start;
  `/etc/chromium.d/kw-wayland` then prints the apt-get line where the
  render node is; `libgles2` is not needed). And the renderer needs
  multisampling (gl.md, patch 17): Chromium's ANGLE (its GL backend on
  the native EGL, `gl=egl-angle,angle=opengl`) offers OpenGL ES 3.0 only
  where each required colour and depth format takes 4 samples, and
  Chromium 156 asks for ES 3.0 and nothing less. Before the patch the
  guest's Mesa offered no multisampling on any WebGL2 host (WebGL2 has
  no multisample textures, the GPU or SwiftShader alike), so its GPU
  process logged `eglCreateContext: Requested version is not supported`
  (ANGLE's EGL refusing ES 3.0 on its ES 2.0 cap, not Mesa: virgl's
  context is ES 3.0) and `ES version fallback is disabled`, exited three
  times, and Chromium composited in software into wl_shm buffers
  (chrome://gpu all "Software only" or "Disabled", WebGL too; seen the
  same on an M4 Pro with ANGLE Metal). Now chrome://gpu has Compositing,
  Rasterization, Canvas and WebGL hardware accelerated, `GL_RENDERER
  ANGLE (Mesa, virgl (ANGLE (...)), OpenGL ES 3.0 Mesa 25.0.7)`, GL_VERSION
  OpenGL ES 3.0 (one more `Requested version is not supported` is a
  context of a higher version, WebGPU's, which stays unusable). Measured
  (one run each, a fresh profile once started before): a CSS animation
  (a 200x200 gradient moving and turning) 54 rAF/s and 51 to 53 commits/s
  by resource against 45 to 49 rAF/s and 44 to 47 commits/s with
  `--disable-gpu` (3084 KiB a commit read in place); a WebGL2 page
  (antialias, 4 samples) 54 rAF/s by resource, while with `--disable-gpu`
  (as before the patch) Chromium has no WebGL; the window maps 10 to 14
  s after the start either way (9.1 to 9.3 s with `--disable-gpu`). No
  flag is needed or set by default (`page-check.mjs --chromium` checks
  the GPU path). Not measured on a GPU.
- GL frame rates (2026-11-22, `page-check.mjs --built --gpu --pacing`,
  headless Chromium on SwiftShader, so a floor; 61 rAF/s; worker mode;
  weston-simple-egl -o, which redraws everything each frame; one run
  each):

  | weston-simple-egl -o | 1 CPU | 4 CPUs |
  | --- | --- | --- |
  | by resource, 250x250 | 60.0 commits/s, 0.15 ms | 60.0, 0.35 ms |
  | by resource, maximized (1280x772) | 55.6, 0.17 ms | 56.1, 0.18 ms |
  | software (`?wlgpu=0`), 250x250 | 59.9, reads 0.44 ms | 60.0, in place 0.01 ms |
  | software (`?wlgpu=0`), maximized | 13.9, reads 1.33 ms (1938 KiB) | 30.7, in place 0.01 ms |

  By resource the page's cost per commit is resolve to release (image()'s
  blit and wland's drawImage of it, as issued: their GPU work runs later
  in Chromium's GPU process and is not counted); image() alone 0.07 to
  0.16 ms. In software the
  guest renders with llvmpipe and the page reads the buffer. glmark2-es2-
  wayland (800x600 windowed, by resource, 1 CPU): build 110, texture 125,
  phong 103 FPS (it swaps without waiting for frame callbacks, and every
  frame is an image).

## Several CPUs

The CPUs option (Settings, Machine, the `#opt-cpus` slider; `?cpus=N`,
config.ts) boots the SMP kernel on N CPUs (kernel/smp.md; js.md, CPU
threads). Default in worker mode where the page can boot the SMP
kernel: the suggested count (`cfg.cpuDefault`); else 1, the UP kernel.
`?cpus=1` is the UP kernel (the same files and code paths as before
the option). The Worker thread and CPUs options are saved only
where they differ from these defaults. It applies on Reboot, like the
other options.

- Choices: 1, 2, 4, 8 and 16 up to `navigator.hardwareConcurrency`, and
  that count itself (the kernel's limit is 16, `NR_CPUS`), plus the suggested count,
  hardwareConcurrency / 2 up to `SUGGESTED_CPUS` (4 on desktops, 2 in
  Firefox and on phones; config.ts, with the
  /profile.html numbers behind it), marked
  "(suggested)" (none below 4 threads; desktop Safari as Chrome: testing.md, Profiling CPUs and worker mode).
  A count past the suggestion (past one where there is none) is there to
  try: selected, the slider, its value and its note turn red (`Stop.warn`).
  Half the host's threads stay free for the page, the browser and other
  tabs: a guest CPU whose thread the host deschedules stalls the CPUs
  that wait for it (status.md, SMP, under host load). A larger `?cpus=` is
  capped at the thread count.
- `smpBlocker()` (config.ts) disables the slider, with the
  reason under it (`#opt-cpus-note`) and in the "Guest CPUs" row of
  System's Environment: no SMP kernel in the page's bundle (`kernelSmpUrl`
  null: a bundle without the SMP patch), no cross-origin isolation (a plain-http
  LAN page), no Web Workers or no `Atomics.waitAsync`
  (`webCpuBlocker({ worker: true })`), or one host thread. Such a load
  with `?cpus=N` boots on one CPU as usual and says why.
- With several CPUs, boot.ts loads `kernelSmpUrl` instead of `kernelUrl`
  (streaming compile; the UP bundle is not fetched) and boots in worker
  mode (`cfg.worker` is set, not `?worker=1`; Settings shows the Worker
  thread box ticked and disabled, keeping its own value for one CPU), with
  `cpus`; the kernel worker starts the other CPUs as nested Web Workers.
  The download starts only after the suspended session was offered
  (below), since the answer picks the kernel. The SMP bundle is a hashed
  `/assets/` file like the UP one: the service worker (scope `/vm/`) never
  sees it, and the HTTP cache keeps each file on its own.
- `/profile.html` (testing.md, Profiling CPUs and worker mode) measures
  the configurations the defaults choose between; `SUGGESTED_CPUS`
  carries the numbers it is based on.
- Falling back: a failed SMP download or compile, or a `createKernel()`
  that rejects (the worker, its JSPI, the shared memory), calls
  `bootUpOnce()`: it stores the reason in sessionStorage `kw-up-once` and
  reloads; that load boots on one CPU the usual way (in worker mode
  where that is the default) and shows the reason (`cfg.smpWhy`: the Guest CPUs row,
  the CPUs note, diagnostics). The saved CPUs setting stays, so the next
  load tries again. If sessionStorage refuses, the failure is reported
  instead (no reload loop). A kernel worker that cannot start CPU threads
  (`webCpuBlocker()` there) runs the SMP kernel on one CPU: the Guest
  CPUs row warns, from `stats().cpus`. A failure after the kernel started
  (a CPU's trap or fatal error) ends the session like any other, with a
  hint to set CPUs to 1.
- The console with several CPUs: every CPU's output comes through the
  console ring the page itself reads (js.md, CPU threads), not through
  the kernel worker, so the terminal gets a few hundred chunks for
  `seq 1 200000` instead of one message per write, and output from a task
  on CPU 1 is not held up while CPU 0 runs user code. Headless Chromium,
  `?cpus=2` (2026-11-17, before, then after): `seq 1 200000` on CPU 1
  37.7-38.4 s and 2.8 s (CPU 0: 2.3-2.5 s); echo of a shell on CPU 1
  while CPU 0 spins, median 9.4 and 0.57 ms; lines printed in turn on
  CPUs 0 and 1 in order either way; the default load unchanged.
- Suspend works with several CPUs (Suspend and resume, below). The
  session records its CPU count (none in sessions saved before: one), and
  resumes only on as many, with the kernel for that count. A load whose
  count differs offers it before the download (`offerResumeCpus()`):
  "Resume on N CPUs" reloads once on N (sessionStorage `kw-cpus-once`,
  config.ts `resumeCpus`; for one CPU `bootUpOnce()`, both with
  `kw-resume`) and resumes it; "Boot on M CPUs" boots this load's count
  and, when the session has a data disk, deletes it (that boot changes the
  disk), else keeps it. Where the page cannot start N CPUs now
  (`smpBlocker()`, this tab's fallback to one CPU, fewer host threads) it
  is not offered: with a data disk the page asks first ("Boot on M CPUs",
  which deletes it, or "Keep it", which stops without booting,
  `keepSession()`), without one it boots M with a warning and keeps it. A
  resume whose CPUs do not start (`createKernel()` rejects, other than for
  a disk or device) keeps the session and reloads on one CPU
  (`bootUpOnce()`), which then asks as above; a resumed SMP session is
  deleted only once user space answers an `exec()` (its tasks resume only
  after every CPU is back, so until then a CPU that fails leaves the disk
  as saved). The SMP kernel on fewer CPUs than asked (the worker could
  not start their threads) refuses Suspend: no load boots that again.
- The boot summary says "on N CPUs"; diagnostics' config
  line has `cpus=`.
- Checked in headless Chromium (Playwright's build, the built page from
  the l2 patch bundle, 2026-11-17, a scratch script, not in `web/test/`):
  the default load fetched only the UP bundle and ran on one CPU; `?cpus=2`
  and `?cpus=4` fetched only the SMP bundle, `nproc` gave 2 and 4, a
  terminal window, glimmer's test pattern, key and sound through worker
  mode worked, the JIT compiled on every CPU, and n parallel awk loops
  took 1.14x (2 CPUs) and 1.20x (4) the time of one; a plain-http LAN
  load disabled the option and booted on one CPU; a blocked SMP download
  reloaded on one CPU; a UP session resumed from a `?cpus=2` load ("Resume
  on 1 CPU") and was deleted by "Boot on 2 CPUs"; a page from the newest
  release (no patch) showed the option disabled and booted UP. Also the
  Vite dev server (nested worker from source).
- Checked by hand on a deployed build (2026-11-17): several CPUs work in
  desktop Chrome, in Firefox and on iOS. Desktop Safari and Android: not
  tried.

## Suspend and resume

Suspend (Ctrl-A z, the Control Center's `#tb-suspend`, the top bar's mark
menu, Settings' footer `#suspend`, or `KW.suspend()`; `ui.suspend()`, no question: the machine stops only once its
session is stored, and Resume brings it back) saves the running machine with the SDK's
`snapshot({ commit })` (js.md, Snapshots), inline or in worker mode: the
kernel waits at its snapshot point while the page writes the session, and
stops only once that transaction committed. A write that fails, or that
takes longer than 20 s of awake time (`SUSPEND_COMMIT_MS` in boot.ts; a
page frozen meanwhile does not use it up), leaves the machine running and
the saved session as it was (`SuspendSaveError`, autosuspend.ts: "the
session was not saved (why); the system runs on"); a record written but
given up after all (the timeout came first) is deleted. The page then shows "Suspended" (an `[  OK  ]` line, not a red
notice; the "Suspending…" toast goes), the store's `suspended` is set,
and a Resume card (`#resume-card` with `#resume`, Overlays.tsx: "The system
is saved in this browser (N MiB).") sits in the middle of the desktop,
over every window (App.tsx renders it after the desktop), whose last
screen shows dimmed behind it (the dim takes no clicks, so a terminal
still scrolls), and the power items say Resume (`#tb-resume`, Settings'
`#resume-settings`). Resume takes the focus when
the card appears (not from a field or dialog the user is in), so Enter or
Space resumes; toasts keep their corner, below it. Resume (`ui.resume()`)
sets sessionStorage `kw-resume` and reloads the same URL; the load reads it
once and resumes. A plain load resumes a session it can resume as it is too,
without a question. Every resume of a saved session (the Resume button, a
plain load, a suspend in the background, the reload on the session's CPU
count) is quiet (below) and ends in the same informational toast, "Resumed
the session suspended …" (`sayResumed()` in boot.ts, 5 s,
`RESUMED_TOAST_MS`; a hidden tab gets it once shown); a machine that goes
on in place (a hold in the background ended, Continue) never stopped and
shows nothing. Reboot sets
`kw-resume` to `fresh` and first deletes any record of the running machine
still saved (held, the resumed one, one a given-up save left;
`KW.beforeReboot`); the load after it boots fresh and, for a session it
could resume (one kept from before), keeps it without a data disk (the next
plain load resumes it) and asks with one (Resume, or Boot fresh, which
deletes it: the fresh boot changes the disk; autosuspend.ts
`resumeChoice()`). So Reboot never leads to the same session again.

- `session.ts` keeps one session in IndexedDB `kwsnap:session-v2`, its own
  database (the first open on a page deletes `kwsnap:session-v1` and any
  other older version, unawaited): `meta` (time, the page's kernel URL, UP
  or SMP, the CPU count, the banner, the device
  options, the disks' snapshot state, the console's last 64 KiB, the
  Browser window (port, path, shown), the terminals 1-9 whose sessions
  the snapshot lists (number, name, session id, the Terminal window they
  were tabs of and whether shown there) and the current terminal) and
  `bytes` (the `encodeSnapshot()` Blob, made before the
  transaction opens), written in one transaction with strict durability
  (where the engine has it), which a given-up commit aborts. It never opens
  `kwdisk:kwdata-v1`.
- Resumed only when the CPU count (another: Several CPUs, above), the
  kernel URL (a hashed asset: another release cannot
  resume), the distro image's URL (`meta.distro`; a build's names its
  content, so another build of the same distro cannot resume) and the device
  options (Display, Sound, Network, Data disk) are
  as saved, and inline when `snapshotDiskMismatch()` passes on the opened
  data disk. A disk that changed makes the session useless, so it is
  deleted then. In worker mode the worker checks the disk; a tab without
  the disk lock is not offered it. Any refusal (a disk, a device, another
  kernel build) boots fresh with a warning line and a toast. A resumed or
  refused session is deleted.
- On a resume the terminal shows only the console's saved tail (the guest
  redraws nothing; below); where the boot lines showed after all (a plain
  load whose session took over 2 s to read), "Resumed the
  session suspended …" and the summary come first.
  Terminals 1-9 survive: their sessions are kwtty's detachable ones
  (js.md), which the restore's reset of their vsock connections detaches
  instead of hanging up, so their shells and programs run on. The resume
  opens each saved terminal again with its number and name, as tabs
  grouped in Terminal windows as they were (older records: all in the
  console's window), `attach()`es its session (`wterms.ts` `reattach()`)
  and selects the terminal that was current at the suspend. The screen comes from kwtty: it replays the last 64 KiB of the
  session's output into the fresh wterm (from a line start, behind the
  terminal modes in force there), and a full-screen program on the
  alternate screen gets two SIGWINCHs and redraws (busybox vi does not use
  the alternate screen: its last full draw in the replay is what shows).
  The guest keeps a detached session for 60 s; one gone by then gives a
  tty N terminal a new shell with a gray line saying so, and an app's
  terminal shows that it ended; a record without terminals reopens none. Not yet
  checked in a browser (the SDK side: `test/api.test.ts`). Network
  connections do not survive (their TCP ends are reset), nor do
  `vm.exec()` pipes. A guest server keeps running and listening, but
  its connections from the old page (the preview's requests) are reset. The
  Browser window open at the suspend (port, path, shown) opens again
  once its port answers (`reopenPreview()`, `waitPort()` from launcher.ts,
  at most 15 s; else a toast says Ctrl-A p opens it), on the new kernel's
  vmId: the old iframe could not have been kept, since the resume is a
  reload.
- Suspend in the background (`autosuspend.ts`, wired in boot.ts;
  `?autosuspend=now|<seconds>|0`, Settings' Session radios
  `#opt-autosuspend-<value>`): once the tab has been hidden that long, the
  page saves the session as Suspend does (written while the kernel waits at
  its snapshot point), but holds the kernel there instead of stopping it
  (`KW.suspend({ hold: true })`, the SDK's `snapshot({ commit, hold })`,
  js.md), for as long as the tab stays hidden; the status is "Paused". As
  soon as the session is stored it sets `kw-resume` to `auto`.
  - Shown again with the page alive (the common case on a phone: a short
    switch to another app), the machine goes on where it was
    (`continueHeld()`): no reload, every terminal window, vsock connection,
    the preview and the guest's state as they were, its clocks moved on by
    the hold (js.md, Snapshots). `kw-resume` is cleared in the same task as
    the release, and the session saved for the hold is deleted after it (by
    its time, as a given-up save's; stale once the guest writes its disks
    again). A page killed between the release and that deletion leaves a
    stale record: the next load resumes it (with its toast), and refuses it
    once the data disk changed, as for a record a given-up save could not
    delete. Quiet: only
    the status ("Paused", then "Running"), the Kernel log and the
    Environment row ("held for N s, continued"). Wisp connections may have
    been closed by their servers meanwhile; the guest's TCP connections over
    them then fail when it goes on (acceptable: a resume loses them too).
  - Killed or discarded by the browser while held: the session is stored,
    so the next load resumes it quietly (`kw-resume` `auto`; Reboot
    deletes the record). After `AUTO_SUSPEND_HOLD_MS` held (10 min, autosuspend.ts;
    counted by the page's timers, so not while the page is frozen) the hold
    becomes the stop, which frees the machine's memory (a held machine keeps
    it all, which may make a phone kill the page sooner); so does a kernel
    or worker that ended while held. The tab, when shown, then resumes it
    (`ui.resumeAuto()`, the Resume reload).
  - The resume is quiet: the suspend wrote nothing to the terminal and showed
    no Resume card (the status is "Suspended", the Kernel log and the
    Environment row say it), and with `kw-resume` `auto` (or `1`, after the
    Resume button: every resume is the same, autosuspend.ts `quietStart()`)
    the load shows "Resuming" (the boot indicator, and the console window's
    placeholder: BootIndicator.tsx `useBlank()`) and holds back
    the host's boot lines until the restore, whose first paint is the screen
    as it was, then the toast; a load that boots fresh or fails after all
    shows them (`unquiet()` in boot.ts). A plain load does the same once
    the session's meta says it can resume it (CPU count, kernel, image,
    devices; else, or after 2 s without an answer, the boot lines show at
    once).
    Real failures still say so (a toast and the row; a machine
    stopped without its session saved, a red notice).
  - During a hold the guest runs nothing: console and terminal input queue
    until it goes on, `sync()` (hiding, `pagehide`, Reboot's) answers at
    once (the disks were sealed at the snapshot point), Suspend (by hand or
    `KW.suspend()`) turns the hold into the stop, and Reboot deletes the
    record and boots fresh. Closing the page asks nothing (the session is
    stored).
  Default
  `now` (at once on `visibilitychange`) where `cfg.mobile` (pointer coarse
  or a mobile user agent): phones and tablets freeze or discard background
  tabs when they like, and iOS stops a hidden page's scripts within
  seconds, so a timer may never fire there. Off on desktops, where a
  background tab keeps running and a machine working there (a build, a
  server used from another tab) is the user's work. Saved only where it
  differs from the device's default.
  - Only a machine worth keeping: one the user typed into, tapped or
    clicked since it booted (trusted `keydown`, `pointerdown`, `input`,
    `paste` outside the page's own controls, focus.ts `isPageChrome()`:
    the system apps, the Dock, the top bar and their menus, `#confirm`),
    or a resumed one. An
    untouched machine boots again in about a second.
  - Shown again before the snapshot started, nothing happens (the timer is
    cancelled); while it saves, it finishes and then goes on. A refusal
    before the copy (a task that does not park, I/O in flight; the machine
    runs on) is tried again while the tab stays hidden, at most 3 times
    1 s apart, then the page syncs the disks as hiding does otherwise; the
    Environment row "Suspend in the background" and a toast once the tab is
    shown say why. A suspend that starts at once skips that sync: the
    snapshot seals the disks at its consistent point.
  - A save that fails (`SuspendSaveError`: the transaction aborted, the
    commit's timeout, a disk seal that did not become durable) leaves the
    machine running as it was (its tasks resume as after a snapshot without
    stop; the guest's clocks move on by the wait), and the disks synced as
    hiding does otherwise; nothing is held. It is not tried again while the tab stays hidden,
    but the next time it is hidden; after 2 failed saves
    (`AUTO_SUSPEND_SAVE_FAILURES`) it stays off for the page load. The row
    and a toast once the tab is shown say why.
  - It never does what doing nothing would not: it does not replace a
    session kept from before (the load after Reboot keeps one without a data disk;
    only Suspend by hand replaces it; a record of this machine's own, the
    resumed one or one a given-up save could not delete, does not count),
    and it does not start when `navigator.storage.estimate()` reports less
    free space than twice a session's usual size (`sessionRoom()`: 80 MiB on
    one CPU, 192 on 8), where the save would only fail after parking the
    machine and writing tens of MiB. The estimate is the browser's own and
    approximate; insecure contexts have none. The checks run at once (a
    hidden page may have seconds), and the snapshot is encoded before its
    transaction opens.
  - What can still be lost: a page that the browser kills (not just
    freezes) while the session is being written loses the running machine,
    as it would have without the suspend; the data disk is then as sealed
    at the snapshot point and the record the earlier one (one transaction).
    A page frozen during the write and woken later goes on: the commit's
    timeout counts awake time, so the transaction's own result (committed,
    or aborted by WebKit) decides. A record given up after all whose
    removal also failed stays: the next load resumes it, a machine with a
    data disk refuses it once the disk changed.
  - WebKit (Safari, every iOS browser): on 2026-11-20 an iPhone lost the
    machine twice before the commit existed (it saved after the stop), once
    with "IndexedDB transaction aborted" for the page's session write
    (Chrome on iOS), once with the worker's exit ahead of the snapshot
    (Safari, worker mode, a data disk: most likely the worker's IndexedDB
    seal had not settled within the exit's 10 s, which then counted wall
    time, so a freeze used it up; reproduced with a slow seal under Node,
    js.md, Worker mode). WebKit is widely reported to drop the IndexedDB
    connections and transactions of pages it suspends in the background
    ("Connection to Indexed Database server lost"); nothing the page does makes a hidden
    page's transaction commit, so those failures now leave the machine
    running instead. Not yet tried on an iPhone with the commit.
- Closing or leaving the page while such a machine runs or is being saved
  asks first (`beforeunload`; `?askleave=0`, the `#opt-askleave` box, turns
  it off). Browsers show their own text and only after the user
  interacted with the page; most phone browsers never ask. The page's own
  reloads and navigations (Reboot, Resume, `bootUpOnce()`, the reload on
  another CPU count, data disk import and reset) call `allowLeave()`
  first. Nothing can be saved from inside the question and no browser
  shows the page's text, and a user who stays (Cancel, Stay) may simply
  want to go on working, so staying changes nothing by itself: once the
  page's timers run again (`LEAVE_STAYED_MS`) and it has the focus back
  (Firefox asks from its parent process, where the page's timers keep
  running), a toast offers "Pause to save this session before closing?"
  with a Pause button (`#toast-action`; the toast's one optional action,
  `ui.toast(msg, { action, run, ms })`, which does not take the focus) for
  `LEAVE_OFFER_MS` (9 s), or until a key is typed for the guest. Doing
  nothing keeps it running. `pagehide` cancels the wait.
- Pause (that button; `KW.pause()`, autosuspend.ts `Pause`) is the hold of
  a suspend in the background with the tab shown: the session committed,
  `kw-resume` set to `auto`, the kernel held at its snapshot point, the
  status "Paused" and the title mark `‖`, and the Resume card shows
  "paused: The session is saved in this browser: you can close this tab."
  with Continue (`#continue`), which does not take the focus: it stays in
  the terminal, where any key continues (Tab reaches the button; the
  display's keyboard routing leaves the card's keys alone). Closing the tab then asks nothing (held), and the next
  load resumes it quietly, as after a hold in the background. Continue, or
  any key typed for the guest (a terminal or the display; not the
  shortcut prefix, the page's own windows, bars and fields: focus.ts
  `ownsKeys()`), goes on in place
  (`continueHeld()`, which deletes the record, as when a held tab is
  shown). Unlike that hold, hiding and showing the tab does not end it
  (AutoSuspend leaves a held machine alone). After `AUTO_SUSPEND_HOLD_MS`
  (10 min of awake time) paused it becomes the stop, and the page shows
  the Resume card as after Suspend (so does a kernel or worker that ended
  while paused, or Suspend pressed meanwhile). A save that fails is a
  toast, "Not saved: why; the system runs on", and the machine runs on.
- No save at the moment the tab closes: a save needs the kernel to park,
  the memory copied and encoded (about 150 ms with the CLI, 2026-11-15)
  and about 30 MiB committed to IndexedDB, and a closing page has no
  guarantee that a transaction it starts commits (with several CPUs
  more: 35 MiB on 2, 54 on 4, 90 on 8; kernel/parking.md, SMP). A
  suspend started by the `visibilitychange` of a closing tab does not
  finish; on a phone the tab is usually hidden (the tab switcher) before
  it is closed, and that suspend has finished by then. A snapshot without
  `stop` would not help: the guest writes `/data` within seconds, which
  makes it unrestorable.
- Checked by hand only (no browser test); suspending in the background
  (with the hold) and the question on leaving not yet on a real phone or
  desktop browser (their decisions: `web/test/autosuspend.test.ts`; the
  SDK's commit, hold and their failures, inline, in worker mode and on
  several CPUs: `test/api.test.ts`).

## Service worker and updates

The page's one service worker (`public/vm-sw.js`, registered by `sw.ts`)
has scope `/vm/`, in dev and in a build alike, and serves only the guest
preview (below). It does not control the page: `/`, `/assets/` (the
kernel among them) and everything else the page loads go to the network
and the HTTP cache, so a reload always runs the newest deploy. There is no
offline copy: a cache-first page stays old whenever caching a new build
fails.

- Its own updates: `register()` with an unchanged script URL does not
  look for a new one, and loads of `/` are outside the scope, so the
  browser's own check on navigation never runs. `sw.ts` therefore calls
  `registration.update()` on every load (the first `serviceWorker()` call,
  when the preview attaches) and again when the tab is shown after an
  hour. `/vm-sw.js` is `no-cache` and registered with
  `updateViaCache: "none"`. A new script activates at once (`skipWaiting`,
  `clients.claim`), so the relay's messages must stay compatible.
- Legacy scope `/`: earlier builds registered the same script at `/` and
  answered `/` and `/assets/` from the Cache API `kw-app-v1`. The browser
  checks that registration's script on each navigation to `/`, so it gets
  the new `vm-sw.js`, which then answers nothing outside `/vm/` (as at
  any scope), deletes `kw-app-*` caches on
  activation, and (`LEGACY` in the worker) answers the old page's
  `{t: "kw-check"}` with `update`,
  so that page's status line offers a reload. The load that brought the
  new script still ran the old cached page; the next one comes from the
  network, and its `boot.ts` calls `dropLegacyScope()`, which unregisters
  `/`. Activation never deletes other caches (`kw-apk-index-v1` is apk.ts's).

## Guest preview

A web server running in the guest (say on port 8000) shows in the Browser
window (`preview.ts`; its content `Preview.tsx`: reload, the address as
`localhost:PORT/path`, which takes a port, a port and path or a path, a
link that opens the same URL in a new tab, over an iframe), or in a tab of
its own, at `/vm/<vmId>/<port>/<path>`. The vmId is random per booted
kernel. Ways to open it: Ctrl-A p (on the last port, localStorage
`kw.previewPort`, else 8000; pressed again it brings the window to the
front, or minimizes it when it is in front), an app's `ports` once the
first answers, the preview in Settings' Network section (`#preview-open`),
`KW.preview.open(port)`, and in the guest `open` or `xdg-open
http://localhost:<port>/<path>` (`open.ts`, after a confirm). It opens in
the right part of the workspace, beside a terminal, with its Dock tile
`#dock-preview`, and the guest's Display window goes under it
(minimized). Closing it unloads the page; minimized, it stays loaded. The
address follows the page (read from the iframe on each load and
navigation), and the page's title is the window's. Inside the iframe the
page sees no keys, so the Ctrl-A prefix needs a click on the toolbar or
the title bar first. It is no URL parameter, so it has no Settings
option.

- Downloads (`public/vm-save.js`, described at its top): a browser's own
  download may not reach the service worker (Safari's asks the network), so
  the relayed documents get that script, which saves an `<a download>`
  itself, and a navigation whose answer would be a download (an attachment,
  or an `application/` type no browser shows) is answered with a document
  that runs it: the file is read through the relay into OPFS (`kw-save`,
  one copy at a time) and downloaded from a blob: link.
- A preview document's root-relative link (a navigation outside `/vm/`
  whose referrer is a preview document) is redirected to the same path on
  that document's guest port.
- Relay: `public/vm-sw.js`, a plain script served at `/vm-sw.js`, outside
  the TypeScript build: the page's one service worker (scope `/vm/`;
  Service worker and updates). The relay is stateless, because
  browsers stop idle service workers. For each request it posts
  `{t: "kw-vm-fetch", vmId, port, method, path, headers, body}` (path
  includes the query, body is an ArrayBuffer or null) with a
  MessagePort of its own to every window client that is not under `/vm/`
  (`clients.matchAll({type: "window", includeUncontrolled: true})`). The
  page whose vmId matches answers `accept` at once, and other tabs
  ignore the message. Then come `head` (status, statusText,
  headers), `chunk` messages (transferred ArrayBuffers), and then `end`, or
  `error` (an HTTP status before `head`). The worker sends `more` when its
  body stream pulls and `cancel` when the stream is cancelled. The page
  may send 4 chunks ahead of `more`. Transferable streams are not used,
  because Safari lacks them. With no `accept` within 5 s the worker
  answers 502 with a short text. If the guest sends no head within 60 s
  after the accept, it answers 504. `/vm/<id>/<port>` without the slash
  gets a 308 to the slash.
- Page side (`preview.ts`): boot.ts calls `attachPreview(vm)` once the
  kernel runs, and `attachPreview(null)` at exit; requests then get 503. The
  first call registers the worker (`sw.ts`), only where `navigator.serviceWorker`
  exists (secure contexts). The window waits until the worker is
  active. It does not use `navigator.serviceWorker.ready`, which never
  resolves, because the scope `/vm/` does not control the page. Requests go
  to `vm.fetch("http://localhost:<port><path>", {method, headers, body,
  redirect: "manual", signal})` (the SDK's, js.md, which follows no
  redirects and does not decode bodies). preview.ts needs only its
  `GuestFetcher` interface. At most 8 relayed requests run at once and the rest queue,
  because each guest connection forks a server process. Request headers
  lose hop-by-hop ones and `host`/`content-length`. `accept-encoding` is
  `identity`, because the browser does not decode a synthesized response.
  `origin` becomes `http://localhost:<port>`, so CSRF checks see the guest's
  own origin.
- Response headers: the worker drops hop-by-hop headers, the guest's own
  COOP/COEP/CORP, and Set-Cookie (a synthesized response cannot set
  cookies). It adds `Cross-Origin-Embedder-Policy: require-corp` and
  `Cross-Origin-Resource-Policy: same-origin`. A document in the
  isolated page's iframe needs a COEP. `credentialless` would also
  let a guest page's CDN assets load in Chrome and Firefox, but Safari
  does not implement it and would block the iframe. With require-corp a
  guest page's cross-origin subresources load only if they send CORP or
  CORS. A redirect to `/x` or to `http://localhost:<port>/x` is rewritten
  under the prefix.
- Root-relative URLs: a preview document's own requests outside `/vm/`
  (`/style.css`, Vite's `/@vite/client`) reach the worker too, since it
  controls that document. It relays them to the document's port
  (`clients.get(clientId)` names it), except `/vm-ws.js`. Navigations
  outside `/vm/` (a link to `/about`) are outside the scope: they reach
  the server, which sends the page, and `main.tsx` sends them back under the
  prefix (`previewEscape()`: the iframe's `data-kw-preview`, or in a tab the
  referrer) instead of booting a second kernel.
- WebSockets never reach a service worker. The worker puts
  `<script src="/vm-ws.js" data-kw-vm data-kw-port>` into each relayed
  navigation answered with HTML (2xx, not 206, no `content-encoding`), right
  after the doctype (else at the start, after a BOM), drops its
  `content-length`, and copies a `'nonce-…'` from the guest's CSP header
  onto the tag. That shim (`public/vm-ws.js`, plain script, `no-cache`)
  replaces `window.WebSocket`. URLs reaching the guest are
  `ws://localhost:<port>` (or 127.0.0.1), this origin's
  `/vm/<vmId>/<port>/…`, and other same-origin paths, which go to the
  document's port. Other URLs get the browser's own WebSocket (`instanceof`
  holds for both). The shim talks to the page over the BroadcastChannel
  `kw-vm-<vmId>` (message format at the top of `vm-ws.js`); the page side
  is `preview-ws.ts`. Each socket is `websocketOver()` (`js/core/ws.ts`,
  RFC 6455 over `vm.connect()`, no extensions) with `origin` set to
  `http://localhost:<port>`. At most 32 sockets are open at once, apart
  from the 8 relayed requests. The guest's messages go out 16 ahead of the
  document's acks, so a slow document holds the guest back. Web Locks
  tell each side when the other is gone: the document holds `kw-ws-<id>`
  while a socket lives, the page holds `kw-vm-<vmId>`. A page that does not
  take a socket within 5 s (none runs that kernel, or an older build) fails
  it: `error`, then `close` 1006. `attachPreview(null)` ends every socket.
- Server: `/vm/**` reaching the server (a shift-reload bypasses the worker,
  or the worker is not installed) gets a 503 page from `server/vm.ts` that
  says the preview needs the page open, not the app. Its link to `/` is
  `rel="noreferrer"`, so `previewEscape()` does not send it back.
  `/vm-sw.js` is `no-cache`, and the worker registers with
  `updateViaCache: "none"`. In `pnpm dev`, Vite serves `public/` and Nitro
  the handler; both carry COOP/COEP.
- Limits: same-origin and trusted content only, since the guest's pages can
  script the unkernel page (`parent.KW`). A sandbox without
  `allow-same-origin` would take the iframe out of the worker's control. A client-side
  router sees the `/vm/<id>/<port>` prefix in `location`. WebSockets opened
  in workers, `about:blank` or `srcdoc` frames, or pages whose CSP (a
  `<meta>` one, or a header without a nonce or `'self'`) blocks the shim
  do not reach the guest. Cookies are not set. A tab on the URL works only while the page that
  owns the vmId stays open, and a reload gives a new vmId. There is no
  back-pressure beyond the 4 chunks ahead plus one per pull. A long
  stream may be cut when the browser stops a worker whose event runs for
  minutes. Checked by hand only, plus a Node harness of the
  relay against a fake `vm.fetch`, and `pnpm test:ws` for the WebSocket
  client. No browser test.
- Trying it by hand: the image's busybox has no httpd. In a terminal
  window, run `sudo apk add busybox-extras`, then `mkdir -p /tmp/www && echo hi >
  /tmp/www/index.html && httpd -f -p 8000 -h /tmp/www`. Or run `sudo apk add
  python3`, then `cd /tmp/www && python3 -m http.server 8000`. Then Ctrl-A
  p, and "Go" after changing the port.

## Launcher

The Dock's first tile (`#dock-launcher`), ⌘K on Apple devices,
Ctrl-Shift-O or Ctrl-A o open the launcher (`#launcher`, `Launcher.tsx`,
described at its top; the store's `launcher`; only while the system
runs): an overlay in the manner of the iOS home screen, the page blurred
behind a search field and a grid: the page's own apps first (Terminal,
Settings, System: the inline `system` group), then a folder per group,
whose face is a fan of its first apps' icons and which opens in place
(`#launcher-folder`). Typing searches every app in one flat grid. The
focus stays in the field (tiles take none), so display.ts never routes
its keys to a program holding the guest's keyboard; arrows select, Enter
opens a folder or runs an app, Esc closes the folder, then clears the
search, then closes the launcher; a click on the backdrop closes it. On
touch devices the field is not focused. A tile's or a folder's menu (a
right click, a long press, the ContextMenu key or Shift-F10;
`#launcher-menu`) has Open, and Keep in Dock or Remove from Dock (the app,
or the folder's group). A running app (a terminal named after it, or a
page app's open window) has a dot under its tile, and picking it shows
that window: an app runs once at a time. One being installed has a bar,
and picking it shows its installer. One the page cannot run
(`unavailable()`: its `needs`, display, net, sound or wayland, ruled out
by the page's options, or `packages` that leave out this boot's distro)
is dimmed, with why. An app with `hidden` set is left out (Browser, which
opens by itself, among them).

The apps are in `src/apps/` (`apps/types.ts`, described at its top): one
file per app in its group's folder, whose `index.ts` declares the group
with `defineGroup()` (title, icon, colours; `inline`: at the top level)
and lists its apps in order; `apps/index.ts` lists the groups (`GROUPS`)
and every app (`APPS`). An app's `kind` is `page`, one of the page's own
windows, which it opens itself (Terminal, Browser, Settings, System; the
same declaration is its window's `AppMeta`), or `terminal` (the default),
which `launcher.ts` runs. An app's `icon` is a glyph or a pictogram as
inline SVG markup (static strings in the app file, set as inner HTML):
project logos from Simple Icons (CC0, the slug in a comment), else the
project's own mark from its site (the source in a comment), crafted ones
otherwise. Apps on the guest's display (the Display window) use its
framebuffer, or X on its DRM device (`apps/xkms.ts`: X + glamor and the
games without a Wayland backend that works here); the other graphical
apps are Wayland windows (Wayland desktop, above).

The page ships no assets for terminal apps, so one is text only
(`TerminalApp`, `launcher.ts` described at its top). `launch()` first
checks in one `vm.exec()` what is missing: the `packages` it names for
this boot's distro (`{ alpine, debian }`) not installed yet, and
`downloads` not in the guest (unless their `unless` test passes). With
nothing missing the app starts at once. Else its installer does the
preparation out of sight (`installer.ts`, `Installer.tsx`, both described
at their top): a small fixed-size window of its own (`install-<id>`,
`#installer-<id>`) with the app's icon, one progress bar, the current
step, a Log disclosure (the real output) and Cancel, while the app's Dock
and launcher tiles show the bar; the user can keep working, minimize it
or start another install meanwhile. It closes when done and the app
starts; a failure stays, with the error, the log and Retry. Progress is
weighted stages and never goes back; the package manager's output is
parsed for it (`packageParser()`: apk's `(3/12) Installing` lines, apt's
`APT::Status-Fd` lines). Cancel only while stopping is safe (the page's
own work and the package manager's downloads; never while packages
unpack, which would leave them half installed); the close button cancels
then, else minimizes. A machine held (Pause, a suspend in the background)
shows as Paused.

The preparation: the app's `files` written under its directory
(`~/.apps/<id>` unless it sets `dir`; an old `~/demos/<id>` is moved
there first) with one `vm.exec()` each (or a function that loads them at
launch with a dynamic import, which keeps their text out of the page's
main chunk), a generated `run.sh` and, when it has packages,
`install.sh`; the downloads; then `install.sh` on pipes (`vm.spawn()`, no
terminal) in a login shell: on Alpine `/etc/kw-apk-enable` when the app
sets `community`, then `apk add`; on Debian `apt-get install`, again
after `apt-get update` when the baked lists name a version the mirror
dropped. `run.sh` runs `./install.sh` first too (a no-op once installed,
so the app's terminal shows only the app; it installs again when the
user removed something), then the `commands`, each printed before it
runs, under `set -e`. The files, the scripts and the terminal are the
session's user's (`user` on the distros): the scripts start with
`SUDO_SH` (`sudo.ts`) and run the package manager, and the commands an
app writes as `$SUDO cmd` (nginx's server, PostgreSQL's `start.sh`,
Ubuntu's chroot, sshfs's mount), with sudo, printed as `sudo cmd`; where
they run as root (the base shell, which has no sudo) both are plain. An
app directory outside the user's reach (nginx's `/srv/nginx`) is made and
handed to the user with sudo, and a file the user cannot write
(PostgreSQL's `createcluster.d` file under `/etc`) is written with sudo.
An app runs only on the distros its `packages` name; its scripts handle
what else differs (Ubuntu's, with no `packages`, runs on both). Files
with absolute paths land outside the app's directory, and files from an
earlier launch are never removed. The distros' nginx default site also
listens on `[::]:80`, which fails in the guest (no IPv6), so the nginx
app replaces it.

Then the app's terminal, named after it: a tab of the Terminal window
that last had the focus, or with `terminal: "window"` (a REPL, an agent,
a full-screen program) a Terminal window of its own, shown with the
app's icon and title while that is its only tab. It runs `sh -lc` with a
wrapper in place of the login shell: `cd <dir> && ./run.sh`, then `exec`
the login shell, so the terminal stays to edit and rerun (an INT trap
keeps the wrapper alive through Ctrl-C). Typing the command into a fresh
shell lost the start of the line, because the login discards input typed
ahead of its prompt. A Wayland app's terminal (`needs.wayland`) is its
log: it closes when run.sh ends with status 0 and stays after a failure.
The preview opens once the guest answers http on the first of its
`ports`.

A terminal app's `downloads` (url, SHA-256, size, guest path, an optional
`unless` shell test) are fetched by the page in its installer
(`download.ts`, described at its top): the sites send no CORS headers and
the page is cross-origin isolated, so it speaks plain http over its own
Wisp connection, as apk.ts does, follows redirects as http (a site that
redirects to https only fails; a download with `cors`, for a site that
sends Access-Control-Allow-Origin such as releases.fx.sh, is a direct
`fetch()` instead), checks the SHA-256 and keeps the file in the Cache
API (`kw-files-v1`), then pushes it with one `vm.exec()` (through a
`.part` file, size checked). A failure is a line in the installer's log,
not fatal, so the app's script checks the file itself and downloads it
when it is missing (Ubuntu does). On 2026-11-15 (Node, the default Wisp
server) the riscv64 Ubuntu Base tarball (31 MB) took 1.5 to 4.4 s to
fetch and 0.2 s to push; the arm64 26.10 one (35 MB) took 0.3 s to push
(Node SDK, 2026-11-18). Launch failures are toasts. The installer is
driven by `test/wland/page-check.mjs --fresh` (the foot tile's apt path);
the rest is checked by hand.

Every app's run.sh then in the launcher (it installed the packages
itself) was run on the aarch64 guest through the Node SDK on 2026-11-18:
a fresh data disk per app, 512 MiB, the files written with `vm.exec()`
and run.sh in a pty session (the terminal's command without the wrapper),
the host's network instead of Wisp, a display or sound card where the app
needs one, and the Ubuntu tarball
pushed as `downloads` does (a scratch harness, not in the repository).
Each reached its working state: the
servers answered over `vm.fetch()` (nitro's echo POST), postgres's `select version()` said aarch64, glimmer drew
frames, radio and speak played sound, sshfs mounted Rebex's server.
Seconds from run.sh's start, the `apk add` step (indexes and packages
over the host's network) first, then the time to the working state:
htop 1.6/1.7, tmux 1.8/2.6, mc 2.6/3.0, Neovim 6.8/7.7 (community), Git
2.8/4.9 (clone 1.6 s), sshfs 2.9/4.6 (mounted, tour done), nginx
1.8/2.1, Nitro 5.9/39.4 (upm install 16 s, `nitro dev`
14 s), PostgreSQL 5.7/19.6 (initdb and start 13 s),
SQLite 1.7/2.9, Valkey 2.1/3.3, radio 1.7 (sound about 1 s after a
station is picked), speak 2.4 (the introduction starts at once),
asciiquarium 6.7/6.8 (community), glimmer 0.1 (no packages), Ubuntu 28
(extracting the pushed tarball; 0.2 later, `apt-get update` 28 s in the
chroot).
The REPL and toolchain apps (Claude Code, fx, Bun, Node.js, Python, Go,
Rust), Doom (Debian's dsda-doom, a Wayland window) and the Browsers,
Desktop and Games groups came after that run and have not been through it.
Docker (Debian only: `docker run --rm hello-world` through the image's
docker shim, kernel/guest.md) came later too: with Docker installed, its
command pulled and ran hello-world in 6 s (Node SDK, 1 GiB, data disk, the
host's network, 2026-11-19); the first run adds the shim's install
(about 1 min).

`?showcase` runs `src/showcase.ts` once the guest is up: a
fast, hands-off tour of the apps, leaving out the web servers (described at its top).
Each step shows a caption and launches its app.
It waits for a process (`pgrep -f`), a pattern on the screen, the display or
the preview, then plays it: keys typed into the terminal, or the evdev
keyboard for glimmer. Then it closes the app. A bar along the top
shows progress, and the tour ends on a title card. `?showcase=a,b` runs only
those steps. The tour does not wait: an app not ready within 30 s is
skipped and logged, as is a step that fails. `?showcase=warm` launches each
app and waits until it is ready, without captions, so apk and npm
installs come from the data disk on later tours. `KW.showcase` has
`skip()`, `pause()` and `resume()`.

## Running and deploying

- `pnpm dev`: Vite on port 8080, all interfaces (`server.host: true` in
  `vite.config.ts`; `pnpm -C web dev --host 127.0.0.1 --port 8090` binds
  and moves it), with the local build once
  `kernel/build.sh all` (or `base` and `distro`) has run, else the newest
  release (The page's kernel and distro images). `pnpm build:web` writes
  `web/.output/` the same way (a build beside the main outputs:
  `KW_KERNEL=<dir>/unkernel.wasm KW_DISTROS=<dir> pnpm build:web`), and
  `pnpm start:web` runs it (port 3000 unless `PORT=`). `pnpm
  typecheck:web` type-checks it.
- On Vercel, Nitro detects the platform and writes `web/.vercel/output`.
  Elsewhere, `NITRO_PRESET=vercel pnpm build:web` produces the same for
  `vercel deploy --prebuilt`. Vercel's build sets `VERCEL`, so it takes
  the newest release: deploy only after a release with this layout
  (unkernel.wasm, distros.json, the images) exists. The images are about
  77 MB of static files (alpine 4.0, debian 72.6 MB).
- A LAN `http://` page is not a secure context: no clipboard API, no
  `deviceMemory`, no Web Locks, and no cross-origin isolation. It still
  works.

## Browser tests (`web/test/`)

Agents run these only when asked. The page is tested by hand with
`pnpm dev` on port 8080, so do not start anything on that port.

`headless.mjs` (`pnpm test:web`: desktop with the JIT compiling and
cross-origin isolation asserted, phone over LAN, nojspi, fetch404, modfail,
lowmem booting to the shell at 128 MiB), `data.mjs` (data disk, overlay root per distro,
safe mode, second tab, export/reset/import) and `net.mjs` (needs the internet), both on
`?distro=alpine` (apk, wget, Alpine's upper layer; `headless.mjs` runs the default image). Shared
code is in `lib.mjs`. They drive Chromium over the DevTools protocol with no
npm dependencies and start the built server (`--dev` starts the Vite dev
server). They use the newest Playwright Chromium in `~/.cache/ms-playwright`
unless `--chrome PATH` or `CHROME=` is given. There is no WebKit test
script.

`open.test.ts` and `autosuspend.test.ts` are no browser tests: plain unit
tests of `src/open.ts` and `src/autosuspend.ts` (`node --test
web/test/open.test.ts web/test/autosuspend.test.ts`).

## Engines

- Several CPUs need, besides JSPI in every worker: cross-origin
  isolation, nested dedicated workers (Chrome, Firefox, Safari 15.5+),
  `Atomics.waitAsync` (Chrome 87+, Safari 16.4+; check Firefox) and
  posting a `WebAssembly.Module` and a shared `WebAssembly.Memory` to a
  worker. Only Chromium has run it (Several CPUs).
- JSPI (`WebAssembly.Suspending`/`promising`) is required: Chrome/Edge
  137+, Firefox 153+, Safari 27+ (every iOS browser uses the system
  WebKit). memory64 is not needed, because the page runs the lowered
  kernel; as of 2026-11 no stable Safari has it.
- Playwright WebKit builds (2336 and 2388) behave like iOS; on 2026-11-13
  they and a real iPhone gave the same hashes with the JIT on and with
  `?jit=0`.
- **Safari 27 runs plain-http pages without a JIT** (2026-11-13, Mac and
  iPhone). On a page that is not a secure context (`http://` at a LAN,
  VPN or proxy address) Safari interprets JS and wasm: kwbench's int
  loop runs at 248 MIPS against 3670 in Chrome on the same Mac. At
  `http://localhost:<port>` or over https it has its JIT. Playwright
  WebKit has no such policy, so it cannot reproduce this. When Safari or
  an iPhone is slow, check the origin first. The page does not warn about
  it.
- JavaScriptCore collects freed JIT modules only when prompted (kwemu.md,
  Collecting freed modules). On an iPhone the JIT row of System's Environment
  should show `collected` keeping up with `freed`, uncollected modules in
  the hundreds, and `refused` 0. Not yet measured on a phone.
