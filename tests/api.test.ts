import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
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
  it("distinguishes missing, conflicting, and internal API failures", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    const missing = await context.app.inject({
      method: "POST",
      url: "/api/libraries/missing/remove",
      headers,
      payload: {},
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toContain("не найдена");
    const conflict = await context.app.inject({
      method: "POST",
      url: "/api/queue",
      headers,
      payload: { filter: {}, startId: "missing" },
    });
    expect(conflict.statusCode).toBe(409);
    vi.spyOn(context.service.catalog, "libraries").mockImplementation(() => {
      throw new Error("disk secret");
    });
    const internal = await context.app.inject({
      url: "/api/libraries",
      headers: { host: "127.0.0.1:4317", cookie: headers.cookie },
    });
    expect(internal.statusCode).toBe(500);
    expect(internal.json()).toEqual({
      error: "Внутренняя ошибка локального сервера",
    });
    context.service.beginShutdown();
    const stopping = await context.app.inject({
      url: "/api/libraries",
      headers: { host: "127.0.0.1:4317", cookie: headers.cookie },
    });
    expect(stopping.statusCode).toBe(503);
  });
  it("returns IDs only for tracks in the requested filter", async () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const addTrack = (id: string, albumKey: string, genres: string[]) =>
      context.service.catalog.upsert({
        id,
        libraryId: library.id,
        relativePath: `${id}.flac`,
        title: id,
        artists: ["Artist"],
        albumTitle: albumKey,
        albumArtists: ["Artist"],
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
    addTrack("included", "selected-album", ["Rock"]);
    addTrack("wrong-genre", "selected-album", ["Pop"]);
    addTrack("wrong-album", "other-album", ["Rock"]);
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const response = await context.app.inject({
      method: "POST",
      url: "/api/track-ids",
      headers: {
        host: "127.0.0.1:4317",
        cookie: String(session.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": session.json().csrf,
      },
      payload: { genres: ["Rock"], albumIds: ["selected-album"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      trackIds: ["included"],
      total: 1,
      truncated: false,
    });
    expect(
      context.service.catalog
        .tracks({
          libraryIds: [],
          folders: [],
          genres: ["Rock"],
          artists: [],
          albumIds: [],
          search: "",
          bookmarksOnly: false,
        })
        .items.find((track) => track.albumKey === "selected-album")
        ?.albumGenres,
    ).toEqual(["Pop", "Rock"]);
  });
  it("loads album formats in one batch for a tracks page", () => {
    const library = context.service.catalog.addLibrary("Library", root);
    for (const [id, albumKey, format] of [
      ["first", "first-album", "flac"],
      ["second", "second-album", "mp3"],
    ] as const)
      context.service.catalog.upsert({
        id,
        libraryId: library.id,
        relativePath: `${id}.${format}`,
        title: id,
        artists: ["Artist"],
        albumTitle: albumKey,
        albumArtists: ["Artist"],
        albumKey,
        genres: [],
        year: null,
        trackNumber: 1,
        discNumber: 1,
        duration: 1,
        format,
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });
    const prepare = context.service.catalog.db.prepare.bind(
      context.service.catalog.db,
    );
    let batchFormatQueries = 0;
    vi.spyOn(context.service.catalog.db, "prepare").mockImplementation(((
      sql: string,
    ) => {
      if (sql.includes("SELECT DISTINCT albumKey id, format FROM tracks"))
        batchFormatQueries++;
      return prepare(sql);
    }) as typeof context.service.catalog.db.prepare);
    const result = context.service.catalog.tracks({
      libraryIds: [],
      folders: [],
      genres: [],
      artists: [],
      albumIds: [],
      search: "",
      bookmarksOnly: false,
    });
    expect(result.items.map((track) => track.albumFormats)).toEqual([
      ["flac"],
      ["mp3"],
    ]);
    expect(batchFormatQueries).toBe(1);
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
    expect(missing.statusCode).toBe(404);
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
  it("renames a library only with CSRF and keeps its path and ID", async () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
    };

    expect(
      (
        await context.app.inject({
          method: "POST",
          url: `/api/libraries/${library.id}/rename`,
          headers,
          payload: { name: "Renamed" },
        })
      ).statusCode,
    ).toBe(403);

    const empty = await context.app.inject({
      method: "POST",
      url: `/api/libraries/${library.id}/rename`,
      headers: { ...headers, "x-csrf-token": session.json().csrf },
      payload: { name: "   " },
    });
    expect(empty.statusCode).toBe(400);

    const missing = await context.app.inject({
      method: "POST",
      url: "/api/libraries/missing/rename",
      headers: { ...headers, "x-csrf-token": session.json().csrf },
      payload: { name: "Renamed" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toContain("не найдена");

    const renamed = await context.app.inject({
      method: "POST",
      url: `/api/libraries/${library.id}/rename`,
      headers: { ...headers, "x-csrf-token": session.json().csrf },
      payload: { name: "  Renamed  " },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      id: library.id,
      name: "Renamed",
      path: root,
    });
    expect(context.service.catalog.library(library.id)).toMatchObject({
      name: "Renamed",
      path: root,
    });
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
      folders: [],
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
  it("groups albums by artists, then puts undated albums before newest years", () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const albums = [
      { id: "beta-new", title: "Zebra", year: 2025, artists: ["Beta"] },
      { id: "alpha-old", title: "Older", year: 2020, artists: ["Alpha"] },
      {
        id: "beta-unknown",
        title: "Zeta",
        year: null,
        artists: ["Beta"],
      },
      { id: "alpha-new", title: "Alpha", year: 2025, artists: ["Alpha"] },
      {
        id: "alpha-unknown",
        title: "Unknown",
        year: null,
        artists: ["Alpha"],
      },
      {
        id: "collaboration",
        title: "Together",
        year: 2024,
        artists: ["Alpha", "Guest"],
      },
    ];
    for (const album of albums)
      context.service.catalog.upsert({
        id: album.id,
        libraryId: library.id,
        relativePath: `${album.id}.flac`,
        title: "Track",
        artists: album.artists,
        albumTitle: album.title,
        albumArtists: album.artists,
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
    ).toEqual([
      "alpha-unknown",
      "alpha-new",
      "alpha-old",
      "collaboration",
      "beta-unknown",
      "beta-new",
    ]);
  });

  it("sorts track-panel album groups by year and keeps tracks ordered inside each group", () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const albums = [
      { id: "beta-new", title: "Beta", year: 2025 },
      { id: "alpha-new", title: "Alpha", year: 2025 },
      { id: "old", title: "Old", year: 2020 },
      { id: "undated", title: "Undated", year: null },
    ];
    for (const album of albums)
      for (const trackNumber of [2, 1])
        context.service.catalog.upsert({
          id: `${album.id}-${trackNumber}`,
          libraryId: library.id,
          relativePath: `${album.id}-${trackNumber}.flac`,
          title: `Track ${trackNumber}`,
          artists: ["Artist"],
          albumTitle: album.title,
          albumArtists: ["Artist"],
          albumKey: album.id,
          genres: [],
          year: album.year,
          trackNumber,
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
    const firstPage = context.service.catalog.tracks(filter, 0, 4);
    const secondPage = context.service.catalog.tracks(filter, 4, 4);

    expect(
      [...firstPage.items, ...secondPage.items].map((track) => track.id),
    ).toEqual([
      "undated-1",
      "undated-2",
      "alpha-new-1",
      "alpha-new-2",
      "beta-new-1",
      "beta-new-2",
      "old-1",
      "old-2",
    ]);
  });

  it("keeps album, track, and queue order aligned by album artists", () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const albums = [
      { id: "beta", year: 2025, artists: ["Beta"] },
      { id: "alpha-new", year: 2025, artists: ["Alpha"] },
      { id: "alpha-unknown", year: null, artists: ["Alpha"] },
      { id: "collaboration", year: 2024, artists: ["Alpha", "Guest"] },
    ];
    for (const album of albums)
      context.service.catalog.upsert({
        id: `${album.id}-track`,
        libraryId: library.id,
        relativePath: `${album.id}.flac`,
        title: "Track",
        artists: album.artists,
        albumTitle: album.id,
        albumArtists: album.artists,
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
    const expected = ["alpha-unknown", "alpha-new", "collaboration", "beta"];
    expect(context.service.catalog.albums(filter).items.map((album) => album.id)).toEqual(expected);
    expect(
      context.service.catalog.tracks(filter).items.map((track) => track.albumKey),
    ).toEqual(expected);
    expect(context.service.catalog.trackIds(filter)).toEqual(
      expected.map((id) => `${id}-track`),
    );
  });

  it("uses the artist-panel Unicode order for albums, tracks, and queues", () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const albums = [
      { id: "cocteau", artist: "Cocteau Twins" },
      { id: "wooden", artist: "Деревянные киты" },
    ];
    for (const album of albums)
      context.service.catalog.upsert({
        id: `${album.id}-track`,
        libraryId: library.id,
        relativePath: `${album.id}.flac`,
        title: "Track",
        artists: [album.artist],
        albumTitle: album.id,
        albumArtists: [album.artist],
        albumKey: album.id,
        genres: [],
        year: 2025,
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
    const expected = ["wooden", "cocteau"];
    expect(context.service.catalog.artists(filter).items.map((item) => item.name)).toEqual([
      "Деревянные киты",
      "Cocteau Twins",
    ]);
    expect(context.service.catalog.albums(filter).items.map((album) => album.id)).toEqual(expected);
    expect(context.service.catalog.tracks(filter).items.map((track) => track.albumKey)).toEqual(expected);
    expect(context.service.catalog.trackIds(filter)).toEqual(
      expected.map((id) => `${id}-track`),
    );
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
    year: number | null = null,
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
      year,
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
    for (const [payload, status] of [
      [{ kind: "wrong", id: "x" }, 400],
      [{ kind: "track", id: "missing" }, 404],
      [{ kind: "library" }, 400],
      [{ kind: "folder", libraryId: "missing", relativePath: ".." }, 400],
    ] as const)
      expect(
        (
          await context.app.inject({
            method: "POST",
            url: "/api/explorer",
            headers,
            payload,
          })
        ).statusCode,
      ).toBe(status);
  });
  it("selects a track file and opens album, library and nested folders", async () => {
    const calls: ExplorerTarget[] = [];
    await context.app.close();
    context = await createApp({
      dataDir: root,
      openExplorer: async (target) => {
        calls.push(target);
      },
    });
    const second = await addTrack(path.join("Z", "second.flac"), "second");
    const first = await addTrack(path.join("A", "first.flac"), "first");
    const headers = await sessionHeaders();
    for (const payload of [
      { kind: "track", id: "second" },
      { kind: "album", id: "album" },
      { kind: "library", libraryId: context.service.catalog.libraries()[0].id },
      {
        kind: "folder",
        libraryId: context.service.catalog.libraries()[0].id,
        relativePath: "A",
      },
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
      { directory: second.folder },
      { directory: path.join(second.folder, "A") },
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
  it("starts a filtered queue with the first track shown in the tracks panel", async () => {
    await addTrack("Old/track.flac", "old", "old-album", 2020);
    await addTrack("New/track.flac", "new", "new-album", 2025);
    const filter = {
      libraryIds: [],
      folders: [],
      genres: [],
      artists: [],
      albumIds: [],
      search: "",
      bookmarksOnly: false,
    };
    const firstInPanel = context.service.catalog.tracks(filter).items[0]?.id;
    const started = await context.app.inject({
      method: "POST",
      url: "/api/queue",
      headers: await sessionHeaders(),
      payload: { filter },
    });

    expect(firstInPanel).toBe("new");
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      position: 0,
      track: { id: "new" },
    });
  });
  it("reports a queue truncated to the first 100,000 tracks", async () => {
    await addTrack("Album/first.flac", "first");
    vi.spyOn(context.service.catalog, "trackIdResult").mockReturnValue({
      trackIds: ["first"],
      total: 100001,
      truncated: true,
    });
    const response = await context.app.inject({
      method: "POST",
      url: "/api/queue",
      headers: await sessionHeaders(),
      payload: { albumId: "album" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      sourceTotal: 100001,
      truncated: true,
    });
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
