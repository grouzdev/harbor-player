import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  emptyCatalogSession,
  normalizeWorkspaceSession,
} from "../src/shared/workspace-session";
import { workspaceSessionStore } from "../src/server/workspace-session";
import { fitWindowBounds, windowStateStore } from "../src/desktop/window-state";
import { createApp } from "../dist/server/app.js";

const roots: string[] = [];
async function directory() {
  await mkdir(".test-data", { recursive: true });
  const root = await mkdtemp(path.resolve(".test-data", "workspace-session-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("workspace session", () => {
  it("isolates malformed sections and rejects incompatible versions", () => {
    const workspace = { mode: "pulse", activePlaylistId: null };
    expect(
      normalizeWorkspaceSession({
        version: 1,
        workspace,
        catalog: { search: 42 },
        player: { seconds: Infinity },
        pulse: { offset: -1 },
      }),
    ).toEqual({ version: 1, workspace });
    expect(normalizeWorkspaceSession({ version: 2, workspace })).toEqual({
      version: 1,
    });
    expect(normalizeWorkspaceSession(null)).toEqual({ version: 1 });
  });

  it("round trips selections and search context without caching catalog data", async () => {
    const root = await directory();
    const catalog = emptyCatalogSession();
    catalog.savedFilter.artists = ["Artist"];
    catalog.search = "query";
    catalog.selected = ["track-1", "track-2"];
    catalog.positions = [
      { id: "tracks", top: 800, left: 0, anchorKey: "track-1", anchorY: -10 },
    ];
    catalog.beforeSearch = {
      expandedLibraryIds: [],
      expandedFolderKeys: [],
      positions: [],
      selectedAlbums: [],
      selectedAlbumId: null,
      selectedArtists: ["Artist"],
      selected: ["previous-track"],
      searchSelectedArtists: null,
      searchSelectedAlbums: null,
      searchSelectedTracks: ["track-1", "track-2"],
    };
    const value = {
      version: 1,
      catalog,
      workspace: { mode: "panels", activePlaylistId: "playlist" },
    };
    const first = workspaceSessionStore(root);
    expect(first.get()).toEqual({ version: 1 });
    first.set(value);
    expect(workspaceSessionStore(root).get()).toEqual(value);
    expect(
      JSON.parse(
        await readFile(path.join(root, "workspace-session.json"), "utf8"),
      ),
    ).toEqual(value);
    expect(first.get()).not.toHaveProperty("queries");
    await writeFile(
      path.join(root, "workspace-session.json.tmp"),
      "{interrupted",
    );
    expect(workspaceSessionStore(root).get()).toEqual(value);
    await writeFile(path.join(root, "workspace-session.json"), "{corrupted");
    expect(workspaceSessionStore(root).get()).toEqual({ version: 1 });
  });

  it("persists through backend restart and enforces the mutation boundary", async () => {
    const root = await directory();
    let context = await createApp({ dataDir: root });
    const host = { host: "127.0.0.1:4317" };
    try {
      const session = await context.app.inject({
        url: "/api/session",
        headers: host,
      });
      const headers = {
        ...host,
        cookie: String(session.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": session.json().csrf,
      };
      const value = {
        version: 1,
        workspace: { mode: "cover", activePlaylistId: null },
      };
      expect(
        (
          await context.app.inject({
            url: "/api/workspace-session",
            method: "POST",
            headers: host,
            payload: value,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await context.app.inject({
            url: "/api/workspace-session",
            method: "POST",
            headers,
            payload: value,
          })
        ).statusCode,
      ).toBe(200);
      expect(
        (
          await context.app.inject({
            url: "/api/workspace-session",
            method: "POST",
            headers,
            payload: { version: 2 },
          })
        ).statusCode,
      ).toBe(400);
      await context.app.close();
      context = await createApp({ dataDir: root });
      const restartedSession = await context.app.inject({
        url: "/api/session",
        headers: host,
      });
      const response = await context.app.inject({
        url: "/api/workspace-session",
        headers: {
          ...host,
          cookie: String(restartedSession.headers["set-cookie"]).split(";")[0],
        },
      });
      expect(response.json()).toEqual(value);
    } finally {
      await context.app.close();
    }
  });
});

describe("desktop window state", () => {
  it("fits an old position into the remaining monitor, including negative coordinates", () => {
    expect(
      fitWindowBounds(
        { x: 3000, y: 900, width: 1400, height: 920 },
        { x: 0, y: 0, width: 1280, height: 720 },
      ),
    ).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
    expect(
      fitWindowBounds(
        { x: -1700, y: 20, width: 1000, height: 700 },
        { x: -1920, y: 0, width: 1920, height: 1080 },
      ),
    ).toEqual({ x: -1700, y: 20, width: 1000, height: 700 });
  });

  it("round trips normal geometry and maximization, but not fullscreen", async () => {
    const root = await directory();
    const value = {
      bounds: { x: 20, y: 30, width: 1200, height: 800 },
      maximized: true,
    };
    expect(windowStateStore(root).get()).toBeUndefined();
    windowStateStore(root).set(value);
    expect(windowStateStore(root).get()).toEqual(value);
    await writeFile(
      path.join(root, "window-state.json"),
      '{"bounds":{"width":-1}}',
    );
    expect(windowStateStore(root).get()).toBeUndefined();
  });
});
