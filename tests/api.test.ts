import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  MAX_BACKGROUND_IMAGE_BYTES,
  MAX_BACKGROUND_IMAGE_BASE64_LENGTH,
} from "../src/shared/appearance-background.js";
import { createApp, rangeFor } from "../dist/server/app.js";
import { apiResponseContract } from "../src/shared/api-contracts.js";
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
  it("accepts numeric presets, rejects invalid values, and clears selection without image uploads", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    const settings = {
      theme: "dark",
      accent: "#b8bd82",
      backgroundRevision: 0,
    };
    const save = (payload: object) =>
      context.app.inject({
        method: "POST",
        url: "/api/appearance",
        headers,
        payload,
      });
    for (const backgroundPreset of [1, 2, 3, 4, 5]) {
      const response = await save({ ...settings, backgroundPreset });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ...settings, backgroundPreset });
      const read = await context.app.inject({
        url: "/api/appearance",
        headers,
      });
      expect(read.json()).toEqual(response.json());
    }
    for (const backgroundPreset of [0, 6, 1.5, "1", null]) {
      expect((await save({ ...settings, backgroundPreset })).statusCode).toBe(
        400,
      );
    }
    expect((await save(settings)).json()).toEqual(settings);
    await save({ ...settings, backgroundPreset: 3 });
    const image = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#d04030" },
    })
      .png()
      .toBuffer();
    const imported = await context.app.inject({
      method: "POST",
      url: "/api/appearance/background",
      headers,
      payload: {
        data: image.toString("base64"),
        theme: settings.theme,
        accent: settings.accent,
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(imported.json()).toEqual({ ...settings, backgroundRevision: 1 });
    expect((await save(settings)).json()).toEqual(settings);
  });

  it("bounds background uploads independently of other request bodies", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    const image = await sharp({
      create: { width: 8, height: 5, channels: 3, background: "#d04030" },
    })
      .png()
      .toBuffer();
    const data = Buffer.concat([
      image,
      Buffer.alloc(13 * 1024 * 1024),
    ]).toString("base64");
    const upload = (data: string) =>
      context.app.inject({
        method: "POST",
        url: "/api/appearance/background",
        headers,
        payload: { data, theme: "dark", accent: "#b8bd82" },
      });
    expect((await upload(data)).statusCode).toBe(200);
    // A one-byte overflow can still fit the base64 length cap.
    expect(
      (
        await upload(
          Buffer.alloc(MAX_BACKGROUND_IMAGE_BYTES + 1).toString("base64"),
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (await upload("A".repeat(MAX_BACKGROUND_IMAGE_BASE64_LENGTH + 4)))
        .statusCode,
    ).toBe(400);
    expect(
      (await upload("A".repeat(MAX_BACKGROUND_IMAGE_BASE64_LENGTH + 64 * 1024)))
        .statusCode,
    ).toBe(413);
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/appearance",
          headers,
          payload: { data },
        })
      ).statusCode,
    ).toBe(413);
  });

  it("validates successful JSON responses through their shared contract", async () => {
    const response = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const contract = apiResponseContract("GET", "/api/session");
    expect(response.statusCode).toBe(200);
    expect(contract?.safeParse(response.json()).success).toBe(true);
  });

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
  it("persists and validates the local auto-scan interval", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const cookie = String(session.headers["set-cookie"]).split(";")[0];
    const headers = {
      host: "127.0.0.1:4317",
      cookie,
      "x-csrf-token": session.json().csrf,
    };
    await expect(
      context.app.inject({
        method: "POST",
        url: "/api/scan-settings",
        headers,
        payload: { autoScanIntervalMinutes: 0 },
      }),
    ).resolves.toMatchObject({ statusCode: 200 });
    const saved = await context.app.inject({
      url: "/api/scan-settings",
      headers: { host: "127.0.0.1:4317", cookie },
    });
    expect(saved.json()).toEqual({ autoScanIntervalMinutes: 0 });
    await expect(
      context.app.inject({
        method: "POST",
        url: "/api/scan-settings",
        headers,
        payload: { autoScanIntervalMinutes: 1 },
      }),
    ).resolves.toMatchObject({ statusCode: 400 });
  });
  it("starts scans in every library with the requested mode", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    const scanAll = vi.spyOn(context.service, "scanAll").mockReturnValue([]);

    const response = await context.app.inject({
      method: "POST",
      url: "/api/libraries/scan",
      headers,
      payload: { force: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(scanAll).toHaveBeenCalledWith(true);
    expect(
      apiResponseContract("POST", "/api/libraries/scan")?.safeParse(
        response.json(),
      ).success,
    ).toBe(true);
  });
  it("manages recovery retention and reports the recovery size", async () => {
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    expect(
      (await context.app.inject({ url: "/api/recovery", headers })).json(),
    ).toMatchObject({ backupRetention: "none", size: 0, hasFiles: false });
    const saved = await context.app.inject({
      method: "POST",
      url: "/api/recovery/settings",
      headers,
      payload: { backupRetention: "7d" },
    });
    expect(saved.json()).toMatchObject({ backupRetention: "7d" });
    await mkdir(path.join(root, "recovery", "legacy"), { recursive: true });
    await writeFile(path.join(root, "recovery", "legacy", "copy.flac"), "1234");
    expect(
      (await context.app.inject({ url: "/api/recovery", headers })).json(),
    ).toMatchObject({ size: 4, hasFiles: true });
    expect(
      (
        await context.app.inject({
          method: "POST",
          url: "/api/recovery/settings",
          headers,
          payload: { backupRetention: "bad" },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await context.app.inject({
          method: "DELETE",
          url: "/api/recovery",
          headers,
        })
      ).json(),
    ).toMatchObject({ size: 0, hasFiles: false });
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
  it("returns complete merge context for the selected albums", async () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const addTrack = (
      id: string,
      albumKey: string,
      relativePath: string,
      albumTitle: string,
    ) =>
      context.service.catalog.upsert({
        id,
        libraryId: library.id,
        relativePath,
        title: id,
        artists: ["Track artist"],
        albumTitle,
        albumArtists: ["Album artist"],
        albumKey,
        genres: ["Rock"],
        year: 2020,
        trackNumber: 1,
        discNumber: 1,
        duration: 1,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });
    addTrack(
      "first",
      "first-album",
      path.join("Artist", "Album", "CD1", "01.flac"),
      "First",
    );
    addTrack(
      "second",
      "second-album",
      path.join("Artist", "Album", "CD2", "02.flac"),
      "Second",
    );
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const response = await context.app.inject({
      method: "POST",
      url: "/api/albums/merge-context",
      headers: {
        host: "127.0.0.1:4317",
        cookie: String(session.headers["set-cookie"]).split(";")[0],
        "x-csrf-token": session.json().csrf,
      },
      payload: { albumIds: ["first-album", "second-album"] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      compatible: true,
      relativeFolder: path.join("Artist", "Album"),
      trackCount: 2,
      sources: [
        { albumId: "first-album", title: "First", trackCount: 1 },
        { albumId: "second-album", title: "Second", trackCount: 1 },
      ],
    });
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
      artists: ["Artist B"],
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

    expect(firstPage.averageGroupSize).toBe(2);
    expect(secondPage.averageGroupSize).toBe(2);

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
    expect(
      context.service.catalog.albums(filter).items.map((album) => album.id),
    ).toEqual(expected);
    expect(
      context.service.catalog
        .tracks(filter)
        .items.map((track) => track.albumKey),
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
    expect(
      context.service.catalog.artists(filter).items.map((item) => item.name),
    ).toEqual(["Деревянные киты", "Cocteau Twins"]);
    expect(
      context.service.catalog.albums(filter).items.map((album) => album.id),
    ).toEqual(expected);
    expect(
      context.service.catalog
        .tracks(filter)
        .items.map((track) => track.albumKey),
    ).toEqual(expected);
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
  it("selects exact playlist occurrences and restores snapshot source after edits", async () => {
    await addTrack("Album/01-first.flac", "first");
    await addTrack("Album/02-second.flac", "second");
    const catalog = context.service.catalog;
    const playlistId = catalog.createPlaylist("Duplicates").playlist.id;
    const detail = catalog.addPlaylistEntries(playlistId, "album", [
      "album",
      "album",
    ]);
    const entryIds = detail.entries.map((entry) => entry.id);
    const headers = await sessionHeaders();
    const start = (payload: object) =>
      context.app.inject({
        method: "POST",
        url: "/api/queue",
        headers,
        payload,
      });
    const started = await start({
      playlistId,
      startId: "first",
      startEntryId: entryIds[1],
    });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({
      playlistId,
      entryId: entryIds[1],
      position: 2,
      total: 4,
      track: { id: "first" },
    });
    expect(
      (await start({ playlistId, startId: "first" })).json().position,
    ).toBe(0);
    expect(
      (
        await start({
          playlistId,
          startId: "missing",
          startEntryId: entryIds[1],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await start({ playlistId, startId: "first", startEntryId: "missing" }))
        .statusCode,
    ).toBe(409);
    catalog.reorderPlaylistEntries(playlistId, [...entryIds].reverse());
    catalog.removePlaylistEntry(playlistId, entryIds[1]);
    catalog.deletePlaylist(playlistId);
    catalog.saveQueue("legacy", new Date().toISOString(), ["first"]);
    await context.app.close();
    context = await createApp({ dataDir: root });
    const restoredHeaders = await sessionHeaders();
    for (const [position, entryId, trackId] of [
      [0, entryIds[0], "first"],
      [1, entryIds[0], "second"],
      [2, entryIds[1], "first"],
      [3, entryIds[1], "second"],
    ] as const) {
      const response = await context.app.inject({
        url: `/api/queue/${started.json().id}?position=${position}`,
        headers: restoredHeaders,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        playlistId,
        entryId,
        position,
        total: 4,
        track: { id: trackId },
      });
      expect(
        apiResponseContract("GET", `/api/queue/${started.json().id}`)?.parse(
          response.json(),
        ),
      ).toMatchObject({ playlistId, entryId });
    }
    const legacy = await context.app.inject({
      url: "/api/queue/legacy?position=0",
      headers: restoredHeaders,
    });
    expect(legacy.json().track.id).toBe("first");
    expect(legacy.json()).not.toHaveProperty("playlistId");
    expect(legacy.json()).not.toHaveProperty("entryId");
  });
  it("allows playlist track batches up to 5000 without a catalog offset cap", async () => {
    const playlistId =
      context.service.catalog.createPlaylist("Paging").playlist.id;
    const headers = await sessionHeaders();
    const page = (query: string) =>
      context.app.inject({
        url: `/api/playlists/${playlistId}/tracks${query}`,
        headers,
      });
    expect((await page("?offset=100001&limit=5000")).statusCode).toBe(200);
    for (const query of ["?offset=-1", "?limit=0", "?limit=5001"])
      expect((await page(query)).statusCode).toBe(400);
  });
  it("returns cyclic consecutive album blocks from a queue", async () => {
    await addTrack("A/01-first.flac", "a-first", "album-a");
    await addTrack("A/02-second.flac", "a-second", "album-a");
    await addTrack("B/01-first.flac", "b-first", "album-b");
    context.service.catalog.saveQueue(
      "album-blocks",
      new Date().toISOString(),
      ["a-first", "a-second", "b-first", "a-first"],
    );
    const headers = await sessionHeaders();

    const first = await context.app.inject({
      url: "/api/queue/album-blocks/album-block?position=1",
      headers: { host: headers.host, cookie: headers.cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      position: 0,
      totalBlocks: 3,
      previousPosition: 3,
      nextPosition: 2,
      tracks: [{ id: "a-first" }, { id: "a-second" }],
    });

    const repeated = await context.app.inject({
      url: "/api/queue/album-blocks/album-block?position=3",
      headers: { host: headers.host, cookie: headers.cookie },
    });
    expect(repeated.json()).toMatchObject({
      position: 3,
      previousPosition: 2,
      nextPosition: 0,
      tracks: [{ id: "a-first" }],
    });

    const retained = await context.app.inject({
      url: "/api/queue/album-blocks/album-block?albumKey=missing&fallbackPosition=2",
      headers: { host: headers.host, cookie: headers.cookie },
    });
    expect(retained.json()).toMatchObject({
      position: 2,
      tracks: [{ id: "b-first" }],
    });
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
  it("clears only completed history entries that have no recovery path", async () => {
    const saved = (
      id: string,
      kind: "move" | "trash",
      status: "done" | "interrupted",
    ) => ({
      id,
      kind,
      createdAt: "2026-09-18T00:00:00.000Z",
      status,
      items: [
        {
          id: `${id}-item`,
          trackId: "track",
          source: "C:\\Music\\source.flac",
          destination: "C:\\Music\\destination.flac",
          size: 1,
          mtimeMs: 0,
          hash: "hash",
          title: id,
          phase:
            status === "done" ? ("done" as const) : ("interrupted" as const),
        },
      ],
    });
    context.service.catalog.saveOperation(saved("move-done", "move", "done"));
    context.service.catalog.saveOperation(saved("trash-done", "trash", "done"));
    context.service.catalog.saveOperation({
      ...saved("hard-trash-done", "trash", "done"),
      recoverable: false,
    });
    context.service.catalog.saveOperation(
      saved("move-interrupted", "move", "interrupted"),
    );
    context.service.catalog.saveJob({
      id: "move-job",
      kind: "operation",
      label: "Перенос",
      status: "done",
      completed: 1,
      total: 1,
      errors: [],
      createdAt: "2026-09-18T00:00:00.000Z",
      operationId: "move-done",
    });
    context.service.catalog.saveJob({
      id: "trash-job",
      kind: "operation",
      label: "Удаление",
      status: "done",
      completed: 1,
      total: 1,
      errors: [],
      createdAt: "2026-09-18T00:00:00.000Z",
      operationId: "trash-done",
    });
    context.service.catalog.db
      .prepare("INSERT INTO http_cache VALUES (?,?,?,?)")
      .run("expired", 200, "{}", 0);

    const response = await context.app.inject({
      method: "DELETE",
      url: "/api/operations/history",
      headers: await sessionHeaders(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ operations: 2, jobs: 1, cache: 1 });
    expect(
      context.service.catalog.history().map((operation) => operation.id),
    ).toEqual(expect.arrayContaining(["trash-done", "move-interrupted"]));
    expect(
      context.service.catalog.history().map((operation) => operation.id),
    ).not.toContain("move-done");
    expect(
      context.service.catalog.history().map((operation) => operation.id),
    ).not.toContain("hard-trash-done");
    expect(context.service.catalog.jobs().map((job) => job.id)).toContain(
      "trash-job",
    );
    expect(context.service.catalog.jobs().map((job) => job.id)).not.toContain(
      "move-job",
    );
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
  it("adds library roots as live folder playlist entries and rejects invalid targets", async () => {
    const library = context.service.catalog.addLibrary("Library", root);
    const playlist = context.service.catalog.createPlaylist("Roots");
    const session = await context.app.inject({
      url: "/api/session",
      headers: { host: "127.0.0.1:4317" },
    });
    const headers = {
      host: "127.0.0.1:4317",
      cookie: String(session.headers["set-cookie"]).split(";")[0],
      "x-csrf-token": session.json().csrf,
    };
    const added = await context.app.inject({
      method: "POST",
      url: `/api/playlists/${playlist.playlist.id}/entries`,
      headers,
      payload: {
        kind: "folder",
        folders: [{ libraryId: library.id, relativePath: "" }],
      },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().entries[0]).toMatchObject({
      kind: "folder",
      snapshot: { title: "Library" },
    });
    for (const [folders, statusCode] of [
      [[{ libraryId: "missing", relativePath: "" }], 404],
      [[{ libraryId: library.id, relativePath: "../outside" }], 400],
    ] as const) {
      const rejected = await context.app.inject({
        method: "POST",
        url: `/api/playlists/${playlist.playlist.id}/entries`,
        headers,
        payload: { kind: "folder", folders },
      });
      expect(rejected.statusCode).toBe(statusCode);
    }
  });
});
