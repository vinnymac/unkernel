// SPDX-License-Identifier: MIT
// Copyright (C) 2026 Pooya Parsa <pooya@pi0.io>
// The launcher's apps (components/Launcher.tsx), in groups: one folder per
// group, named after its id, with an index.ts that declares it and lists its
// apps, one file each (types.ts). The groups are listed here in the order the
// launcher shows them: the page's own apps (inline, at the top level), then
// the folders.
// A new app: a file in its group's folder, added to that folder's index.ts.
// A new group: a folder with an index.ts (defineGroup()), added below.
import agents from "./agents/index.ts";
import browsers from "./browsers/index.ts";
import desktop from "./desktop/index.ts";
import games from "./games/index.ts";
import gl from "./gl/index.ts";
import linux from "./linux/index.ts";
import media from "./media/index.ts";
import runtimes from "./runtimes/index.ts";
import servers from "./servers/index.ts";
import system from "./system/index.ts";
import tools from "./tools/index.ts";
import torrents from "./torrents/index.ts";
import type { App, Group } from "./types.ts";

export const GROUPS: Group[] = [system, torrents, agents, tools, runtimes, servers, linux, browsers, desktop, games, media, gl];
/** Every app, hidden ones too, in the groups' order. */
export const APPS: App[] = GROUPS.flatMap((g) => g.apps);
