import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createApp, rangeFor } from "../dist/server/app.js";
import {
  explorerArgs,
  explorerCommand,
  type ExplorerTarget,
} from "../dist/server/explorer.js";

let root: string;
let context: Awaited<ReturnType<typeof createApp>>;
beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "api-"));
  context = await createApp({ dataDir: root });
});
afterEach(async () => {
  await context.app.close();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe cleanup");
  await rm(root, { recursive: true, force: true });
});
describe("HTTP boundary", () => {
  it("rejects DNS rebinding, foreign origins and unauthenticated clients", async () => {
    expect(
      (
        await context.app.inject({
          url: "/api/session",
          headers: { host: "evil.test:4317" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await context.app.inject({
          url: "/api/session",
          headers: { host: "127.0.0.1:4317", origin: "https://evil.test" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await context.app.inject({
          url: "/api/tracks",
          headers: { host: "127.0.0.1:4317" },
        })
      ).statusCode,
    ).toBe(401);
  });
  it("requires CSRF and validates mutation inputs", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const cookie = String(session.headers["set-cookie"]).split(";")[0];
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/libraries",
          headers: { host: "127.0.0.1:4317", cookie },
          payload: { path: "relative" },
        })
      ).statusCode,
    ).toBe(403);
    const response = await context.app.inject({
      method: "POST",
      url: "/api/libraries",
      headers: {
        host: "127.0.0.1:4317",
        cookie,
        "x-csrf-token": session.json().csrf,
      },
      payload: { path: "relative" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("абсолютный");
  });
  it("removes a library only with CSRF and reports an unknown library", async () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const cookie = String(session.headers["set-cookie"]).split(";")[0];
    const headers = { host: "127.0.0.1:4317", cookie };

    expect(
      (
        await context.app.inject({
          method: "POST",
          url: `/api/libraries/${library.id}/remove`,
          headers,
        })
      ).statusCode,
    ).toBe(403);

    const missing = await context.app.inject({
      method: "POST",
      url: "/api/libraries/missing/remove",
      headers: { ...headers, "x-csrf-token": session.json().csrf },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error).toContain("не найдена");

    const removed = await context.app.inject({
      method: "POST",
      url: `/api/libraries/${library.id}/remove`,
      headers: { ...headers, "x-csrf-token": session.json().csrf },
    });
    expect(removed.statusCode).toBe(200);
    await context.service.idle();
    expect(context.service.catalog.libraries()).toEqual([]);
  });
  it("returns facet relevance independently of the active library filter", async () => {
    const first = context.service.catalog.addLibrary("First", root);
    const second = context.service.catalog.addLibrary(
      "Second",
      `${root}-second`,
    );
    const addTrack = (
      id: string,
      libraryId: string,
      albumKey: string,
      albumArtists: string[],
      genres: string[],
    ) =>
      context.service.catalog.upsert({
        id,
        libraryId,
        relativePath: `${id}.flac`,
        title: id,
        artists: albumArtists,
        albumTitle: albumKey,
        albumArtists,
        albumKey,
        genres,
        year: null,
        trackNumber: 1,
        discNumber: 1,
        duration: 1,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });
    addTrack("artist-track", first.id, "artist-album", ["Artist A"], ["Rock"]);
    addTrack("album-track", second.id, "selected-album", ["Artist B"], []);
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const filter = {
      libraryIds: [first.id],
      genres: ["Rock"],
      artists: ["Artist A"],
      albumIds: ["selected-album"],
      search: "ignored",
      bookmarksOnly: true,
    };
    const response = await context.app.inject({
      url: `/api/facet-relevance?${new URLSearchParams({
        filter: JSON.stringify(filter),
        offset: "0",
        limit: "200",
      })}`,
      headers: {
        host: "127.0.0.1:4317",
        cookie: String(session.headers["set-cookie"]).split(";")[0],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      libraryIds: [first.id, second.id].sort(),
      genres: ["", "Rock"],
    });
  });
  it("normalizes facet selections from library through album", async () => {
    const first = context.service.catalog.addLibrary("First", root);
    const second = context.service.catalog.addLibrary(
      "Second",
      `${root}-second`,
    );
    const addTrack = (
      id: string,
      libraryId: string,
      albumKey: string,
      artist: string,
      genre: string,
    ) =>
      context.service.catalog.upsert({
        id,
        libraryId,
        relativePath: `${id}.flac`,
        title: id,
        artists: [artist],
        albumTitle: albumKey,
        albumArtists: [artist],
        albumKey,
        genres: [genre],
        year: null,
        trackNumber: 1,
        discNumber: 1,
        duration: 1,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });
    addTrack("first-rock", first.id, "first-rock", "Shared", "Rock");
    addTrack("first-jazz", first.id, "first-jazz", "First only", "Jazz");
    addTrack(
      "second-electronic",
      second.id,
      "second-electronic",
      "Second only",
      "Electronic",
    );
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const filter = {
      libraryIds: [first.id],
      folders: [],
      genres: ["Rock", "Electronic"],
      artists: ["Shared", "Second only"],
      albumIds: ["first-rock", "first-jazz", "second-electronic"],
      search: "",
      bookmarksOnly: false,
    };

    const response = await context.app.inject({
      url: `/api/filter-validity?${new URLSearchParams({
        filter: JSON.stringify(filter),
      })}`,
      headers: {
        host: "127.0.0.1:4317",
        cookie: String(session.headers["set-cookie"]).split(";")[0],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      genres: ["Rock"],
      artists: ["Shared"],
      albumIds: ["first-rock"],
    });
  });
  it("returns one folder level with recursive track counts", async () => {
    const library = context.service.catalog.addLibrary("Folders", root);
    for (const [id, relativePath] of [
      ["one", path.join("Artist", "Album", "one.flac")],
      ["two", path.join("Artist", "Live", "two.flac")],
      ["other", path.join("Other", "other.flac")],
    ])
      context.service.catalog.upsert({
        id,
        libraryId: library.id,
        relativePath,
        title: id,
        artists: [],
        albumTitle: id,
        albumArtists: [],
        albumKey: id,
        genres: [],
        year: null,
        trackNumber: 1,
        discNumber: 1,
        duration: 1,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
    };

    const rootFolders = await context.app.inject({
      url: `/api/libraries/${library.id}/folders`,
      headers,
    });
    expect(rootFolders.statusCode).toBe(200);
    expect(rootFolders.json()).toEqual([
      expect.objectContaining({
        name: "Artist",
        trackCount: 2,
        hasChildren: true,
      }),
      expect.objectContaining({
        name: "Other",
        trackCount: 1,
        hasChildren: false,
      }),
    ]);

    const children = await context.app.inject({
      url: `/api/libraries/${library.id}/folders?${new URLSearchParams({ parent: "Artist" })}`,
      headers,
    });
    expect(children.json()).toEqual([
      expect.objectContaining({ name: "Album", trackCount: 1 }),
      expect.objectContaining({ name: "Live", trackCount: 1 }),
    ]);
  });
  it("parses bounded, open-ended and suffix ranges and rejects malformed ones", () => {
    expect(rangeFor("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(rangeFor("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(rangeFor("bytes=-5", 100)).toEqual({ start: 95, end: 99 });
    for (const range of [
      "bytes=100-",
      "bytes=20-10",
      "bytes=-0",
      "bytes=0-2,4-8",
      "bad",
    ])
      expect(() => rangeFor(range, 100)).toThrow();
  });
});

describe("Album catalog sorting", () => {
  it("puts albums without a year first, then sorts by newest year and title", () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const albums = [
      { id: "unknown-z", title: "Zeta", year: null },
      { id: "new-z", title: "Zebra", year: 2025 },
      { id: "old", title: "Older", year: 2020 },
      { id: "unknown-a", title: "Alpha", year: null },
      { id: "new-a", title: "Alpha", year: 2025 },
    ];
    for (const album of albums)
      context.service.catalog.upsert({
        id: album.id,
        libraryId: library.id,
        relativePath: `${album.id}.flac`,
        title: "Track",
        artists: [],
        albumTitle: album.title,
        albumArtists: [],
        albumKey: album.id,
        genres: [],
        year: album.year,
        trackNumber: 1,
        discNumber: 1,
        duration: 1,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });

    const filter = {
      libraryIds: [],
      genres: [],
      artists: [],
      albumIds: [],
      search: "",
    };
    const firstPage = context.service.catalog.albums(filter, 0, 3);
    const secondPage = context.service.catalog.albums(filter, 3, 3);

    expect(
      [...firstPage.items, ...secondPage.items].map((album) => album.id),
    ).toEqual(["unknown-a", "unknown-z", "new-a", "new-z", "old"]);
  });
});

describe("Explorer endpoint", () => {
  async function sessionHeaders() {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    return {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
  }
  async function addTrack(
    relativePath: string,
    id: string,
    albumKey = "album",
  ) {
    const folder = path.join(root, "Music");
    const file = path.join(folder, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "audio");
    const library =
      context.service.catalog.libraries()[0] ||
      context.service.catalog.addLibrary("Music", folder);
    context.service.catalog.upsert({
      id,
      libraryId: library.id,
      relativePath,
      title: id,
      artists: [],
      albumTitle: "Album",
      albumArtists: [],
      albumKey,
      genres: [],
      year: null,
      trackNumber: null,
      discNumber: null,
      duration: 0,
      format: "flac",
      size: 5,
      mtimeMs: 0,
      coverId: null,
      available: true,
    });
    return { file, folder };
  }
  it("requires CSRF and rejects invalid or unavailable explorer targets", async () => {
    const headers = await sessionHeaders();
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/explorer",
          headers: { host: headers.host, cookie: headers.cookie },
          payload: { kind: "track", id: "missing" },
        })
      ).statusCode,
    ).toBe(403);
    for (const payload of [
      { kind: "wrong", id: "x" },
      { kind: "track", id: "missing" },
    ])
      expect(
        (
          await context.app.inject({
            method: "POST",
            url: "/api/explorer",
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(400);
  });
  it("selects a track file and opens the first album folder", async () => {
    const calls: ExplorerTarget[] = [];
    await context.app.close();
    context = await createApp({
      dataDir: root,
      openExplorer: async (target) => {
        calls.push(target);
      },
    });
    const second = await addTrack("Z/second.flac", "second");
    const first = await addTrack("A/first.flac", "first");
    const headers = await sessionHeaders();
    for (const payload of [
      { kind: "track", id: "second" },
      { kind: "album", id: "album" },
    ]) {
      const response = await context.app.inject({
        method: "POST",
        url: "/api/explorer",
        headers,
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
    expect(calls).toEqual([
      { directory: path.dirname(second.file), selectFile: second.file },
      { directory: path.dirname(first.file) },
    ]);
  });
  it("starts an album queue with every album track in playback order", async () => {
    await addTrack("Album/02-second.flac", "second");
    await addTrack("Album/01-first.flac", "first");
    const headers = await sessionHeaders();
    const started = await context.app.inject({
      method: "POST",
      url: "/api/queue",
      headers,
      payload: { albumId: "album" },
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ position: 0, total: 2 });
    expect(started.json().track.id).toBe("first");
    const queue = await context.app.inject({
      url: `/api/queue/${started.json().id}?position=1`,
      headers: { host: headers.host, cookie: headers.cookie },
    });
    expect(queue.statusCode).toBe(200);
    expect(queue.json().track.id).toBe("second");

    const fromSelected = await context.app.inject({
      method: "POST",
      url: "/api/queue",
      headers,
      payload: { albumId: "album", startId: "second" },
    });
    expect(fromSelected.statusCode).toBe(200);
    expect(fromSelected.json()).toMatchObject({ position: 1, total: 2 });
    expect(fromSelected.json().track.id).toBe("second");

    const fromFilter = await context.app.inject({
      method: "POST",
      url: "/api/queue",
      headers,
      payload: {
        filter: {
          libraryIds: [],
          folders: [],
          genres: [],
          artists: [],
          albumIds: ["album"],
          search: "",
          bookmarksOnly: false,
        },
      },
    });
    expect(fromFilter.statusCode).toBe(200);
    expect(fromFilter.json()).toMatchObject({ position: 0, total: 2 });
    expect(fromFilter.json().track.id).toBe("first");
  });
  it("builds Windows Explorer arguments for folders and selected files", () => {
    expect(explorerArgs({ directory: "C:\\Music\\Album" })).toEqual([
      "C:\\Music\\Album",
    ]);
    expect(
      explorerArgs({
        directory: "C:\\Music\\Album",
        selectFile: "C:\\Music\\Album\\track.flac",
      }),
    ).toEqual(["/select,", "C:\\Music\\Album\\track.flac"]);
    expect(
      explorerCommand({
        directory: "C:\\Music\\Album",
        selectFile: "C:\\Music\\Album\\track.flac",
      }),
    ).toEqual({
      command: "explorer.exe",
      args: ["/select,", "C:\\Music\\Album\\track.flac"],
      options: { stdio: "ignore" },
    });
  });
});
