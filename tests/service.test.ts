import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  copyFile,
  readFile,
  writeFile,
  rename,
  rm,
  stat,
  utimes,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { MusicService } from "../dist/server/service.js";
import { readTrack } from "../dist/server/metadata.js";
import { emptyFilter } from "../src/shared/contracts.js";
import { compareArtistNames } from "../src/shared/artist-grouping.js";
import { audioDigest } from "../src/server/audio-digest.js";
import { writeTagsIsolated } from "../dist/server/isolated-tag-writer.js";
import { parseFile } from "music-metadata";

let root: string;
let external: string | undefined;
let service: MusicService;
const fixtures = path.resolve(".fixtures");
beforeAll(() => {
  if (!existsSync(path.join(fixtures, "sample.flac")))
    execFileSync(process.execPath, ["scripts/generate-fixtures.mjs"]);
});
beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "service-"));
  service = new MusicService(path.join(root, "data"));
  service.capabilities = {
    writableFormats: ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"],
    verificationDate: new Date().toISOString(),
  };
});
afterEach(async () => {
  await service.close();
  if (!root.startsWith(path.resolve(".test-data") + path.sep))
    throw new Error("Unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
  if (external) {
    if (!external.startsWith(path.join(os.tmpdir(), "harbor-player-test-")))
      throw new Error("Unsafe external test cleanup");
    await rm(external, { recursive: true, force: true });
    external = undefined;
  }
});
async function library(name: string, extension = "flac") {
  const folder = path.join(root, name);
  await mkdir(path.join(folder, "Album"), { recursive: true });
  await copyFile(
    path.join(fixtures, `sample.${extension}`),
    path.join(folder, "Album", `track.${extension}`),
  );
  const { library } = await service.addLibrary(name, folder);
  await service.idle();
  return library;
}
const tracks = () => service.catalog.tracks(emptyFilter).items;

describe("catalog and safe filesystem operations", () => {
  it("disconnects a library after scans without removing its source files", async () => {
    const lib = await library("Disconnect");
    const source = path.join(lib.path, "Album", "track.flac");

    const job = service.removeLibrary(lib.id);
    await service.idle();

    expect(job.status).toBe("done");
    expect(service.catalog.libraries()).not.toContainEqual(
      expect.objectContaining({ id: lib.id }),
    );
    expect(tracks()).toEqual([]);
    await expect(stat(source)).resolves.toMatchObject({
      isFile: expect.any(Function),
    });
  });

  it("filters bookmarks with artist and album inheritance", () => {
    const catalog = service.catalog;
    const lib = catalog.addLibrary("Bookmarks", path.join(root, "Bookmarks"));
    const addTrack = (
      id: string,
      albumKey: string,
      albumTitle: string,
      albumArtist: string,
    ) =>
      catalog.upsert({
        id,
        libraryId: lib.id,
        relativePath: `${id}.flac`,
        title: id,
        artists: [albumArtist],
        albumTitle,
        albumArtists: [albumArtist],
        albumKey,
        genres: ["Test"],
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
    addTrack("artist-first", "artist-album", "Artist album", "Artist");
    addTrack("artist-second", "artist-album", "Artist album", "Artist");
    addTrack("album-track", "saved-album", "Saved album", "Other");
    addTrack("saved-track", "plain-album", "Plain album", "Third");
    addTrack("hidden-track", "hidden-album", "Hidden album", "Hidden");

    catalog.setBookmark("artist", "Artist", true);
    catalog.setBookmark("album", "saved-album", true);
    catalog.setBookmark("track", "saved-track", true);

    expect(catalog.bookmarks()).toEqual([
      { kind: "artist", id: "Artist" },
      { kind: "album", id: "saved-album" },
      { kind: "track", id: "saved-track" },
    ]);
    const bookmarked = { ...emptyFilter, bookmarksOnly: true };
    expect(
      catalog
        .tracks(bookmarked)
        .items.map((track) => track.id)
        .sort(),
    ).toEqual(["album-track", "artist-first", "artist-second", "saved-track"]);
    expect(
      catalog
        .albums(bookmarked)
        .items.map((album) => album.id)
        .sort(),
    ).toEqual(["artist-album", "plain-album", "saved-album"]);
    expect(
      catalog
        .artists(bookmarked)
        .items.map((artist) => artist.name)
        .sort(),
    ).toEqual(["Artist", "Other", "Third"]);

    catalog.setBookmark("artist", "Artist", false);
    expect(
      catalog
        .tracks(bookmarked)
        .items.map((track) => track.id)
        .sort(),
    ).toEqual(["album-track", "saved-track"]);
  });
  it("counts album artists per genre and distinct albums per artist", () => {
    const catalog = service.catalog;
    const lib = catalog.addLibrary(
      "Facet counts",
      path.join(root, "Facet counts"),
    );
    const addTrack = (
      id: string,
      albumKey: string,
      albumArtists: string[],
      genres: string[],
    ) =>
      catalog.upsert({
        id,
        libraryId: lib.id,
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
    addTrack("one", "album-one", ["Artist A", "Artist B"], ["Rock"]);
    addTrack("two", "album-one", ["Artist A", "Artist B"], ["Rock"]);
    addTrack("three", "album-two", ["Artist A"], ["Rock"]);
    addTrack("four", "album-three", ["Artist C"], ["Jazz"]);

    expect(catalog.genres(emptyFilter)).toEqual([
      { name: "Jazz", count: 1 },
      { name: "Rock", count: 2 },
    ]);
    expect(catalog.artists(emptyFilter).items).toEqual([
      { name: "Artist A", count: 2 },
      { name: "Artist B", count: 1 },
      { name: "Artist C", count: 1 },
    ]);
    expect(catalog.artists(emptyFilter).averageGroupSize).toBe(3);
    expect(catalog.genres({ ...emptyFilter, libraryIds: [lib.id] })).toEqual([
      { name: "Jazz", count: 1 },
      { name: "Rock", count: 2 },
    ]);
  });
  it("uses Unicode artist ordering consistently across pages", () => {
    const catalog = service.catalog;
    const lib = catalog.addLibrary(
      "Unicode artists",
      path.join(root, "Unicode artists"),
    );
    for (const [index, artist] of [
      "écho",
      "Eels",
      "Би-2",
      "🎵 Artist",
      "7 Seconds",
    ].entries()) {
      catalog.upsert({
        id: `unicode-${index}`,
        libraryId: lib.id,
        relativePath: `unicode-${index}.flac`,
        title: artist,
        artists: [artist],
        albumTitle: artist,
        albumArtists: [artist],
        albumKey: `unicode-${index}`,
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
    }

    const full = catalog.artists(emptyFilter).items.map((item) => item.name);
    const paged = [
      ...catalog.artists(emptyFilter, 0, 2).items,
      ...catalog.artists(emptyFilter, 2, 2).items,
      ...catalog.artists(emptyFilter, 4, 2).items,
    ].map((item) => item.name);
    expect(paged).toEqual(full);
    expect(
      full.every(
        (name, index) =>
          index === 0 || compareArtistNames(full[index - 1], name) <= 0,
      ),
    ).toBe(true);
    expect(full.slice(0, 2).sort()).toEqual(["7 Seconds", "🎵 Artist"]);
  });
  it("indexes track artists when album artists are absent", () => {
    const catalog = service.catalog;
    const lib = catalog.addLibrary(
      "Fallback artists",
      path.join(root, "Fallback artists"),
    );
    catalog.upsert({
      id: "fallback-artist",
      libraryId: lib.id,
      relativePath: "track.flac",
      title: "Track",
      artists: ["Исполнитель трека"],
      albumTitle: "Album",
      albumArtists: [],
      albumKey: "fallback-album",
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

    expect(catalog.artists(emptyFilter).items).toEqual([
      { name: "Исполнитель трека", count: 1 },
    ]);
    expect(
      catalog.tracks({ ...emptyFilter, artists: ["Исполнитель трека"] }).total,
    ).toBe(1);
    expect(catalog.quickSearch("Исполнитель").artists).toEqual([
      { name: "Исполнитель трека", count: 1 },
    ]);
    expect(catalog.quickSearch("Album").albums).toMatchObject([
      { id: "fallback-album", artists: ["Исполнитель трека"] },
    ]);
    expect(catalog.albums(emptyFilter).items).toMatchObject([
      { id: "fallback-album", artists: ["Исполнитель трека"] },
    ]);

    catalog.upsert({
      id: "fallback-artist-two",
      libraryId: lib.id,
      relativePath: "track-two.flac",
      title: "Track two",
      artists: ["Другой исполнитель"],
      albumTitle: "Album",
      albumArtists: [],
      albumKey: "fallback-album",
      genres: [],
      year: null,
      trackNumber: 2,
      discNumber: 1,
      duration: 1,
      format: "flac",
      size: 1,
      mtimeMs: 1,
      coverId: null,
      available: true,
    });
    expect(catalog.albums(emptyFilter).items).toMatchObject([
      {
        id: "fallback-album",
        artists: ["Другой исполнитель", "Исполнитель трека"],
      },
    ]);
  });
  it("quick-searches and ranks tracks, albums, artists and genres", () => {
    const catalog = service.catalog;
    const lib = catalog.addLibrary(
      "Quick search",
      path.join(root, "Quick search"),
    );
    const addTrack = (
      id: string,
      title: string,
      albumKey: string,
      albumTitle: string,
      artist: string,
      genre: string,
      available = true,
    ) =>
      catalog.upsert({
        id,
        libraryId: lib.id,
        relativePath: `${id}.flac`,
        title,
        artists: [artist],
        albumTitle,
        albumArtists: [artist],
        albumKey,
        genres: [genre],
        year: 2026,
        trackNumber: 1,
        discNumber: 1,
        duration: 60,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available,
      });
    addTrack("exact", "Miracle", "miracle", "Miracle", "Miracle", "Miracle");
    addTrack(
      "prefix",
      "Miracle Road",
      "road",
      "Miracle Road",
      "Miracle Band",
      "Miracle Pop",
    );
    addTrack("contains", "A Miracle Song", "other", "Other", "Other", "Rock");
    addTrack("offline", "Miracle Lost", "lost", "Lost", "Lost", "Lost", false);

    const result = catalog.quickSearch("Miracle", 6);
    expect(result.tracks.map((track) => track.id)).toEqual([
      "exact",
      "prefix",
      "contains",
    ]);
    expect(result.albums.map((album) => album.id)).toEqual(["miracle", "road"]);
    expect(result.artists.map((artist) => artist.name)).toEqual([
      "Miracle",
      "Miracle Band",
    ]);
    expect(result.genres.map((genre) => genre.name)).toEqual([
      "Miracle",
      "Miracle Pop",
    ]);
    expect(catalog.quickSearch("%", 6)).toEqual({
      genres: [],
      artists: [],
      albums: [],
      tracks: [],
    });
  });
  it("searches Unicode substrings without depending on case", () => {
    const catalog = service.catalog;
    const lib = catalog.addLibrary(
      "Мумий фонотека",
      path.join(root, "Мумий фонотека"),
    );
    catalog.upsert({
      id: "mummy",
      libraryId: lib.id,
      relativePath: path.join("Мумий тролль", "Альбом", "track.flac"),
      title: "Песня Мумий",
      artists: ["Мумий Тролль"],
      albumTitle: "Мумий тролль",
      albumArtists: ["Мумий Тролль"],
      albumKey: "mummy-album",
      genres: ["Мумий-рок"],
      year: 2026,
      trackNumber: 1,
      discNumber: 1,
      duration: 60,
      format: "flac",
      size: 1,
      mtimeMs: 1,
      coverId: null,
      available: true,
    });

    for (const search of ["мум", "Мум", "МУМ"]) {
      const filter = { ...emptyFilter, search };
      expect(catalog.tracks(filter).items.map((track) => track.id)).toEqual([
        "mummy",
      ]);
      expect(catalog.albums(filter).items.map((album) => album.id)).toEqual([
        "mummy-album",
      ]);
      expect(catalog.artists(filter).items).toEqual([
        { name: "Мумий Тролль", count: 1 },
      ]);
      expect(catalog.genres(filter)).toEqual([{ name: "Мумий-рок", count: 1 }]);
      expect(catalog.libraries(filter).map((library) => library.id)).toEqual([
        lib.id,
      ]);
      expect(catalog.folders(lib.id, null, filter)).toEqual([
        expect.objectContaining({ name: "Мумий тролль", trackCount: 1 }),
      ]);

      const quick = catalog.quickSearch(search);
      expect(quick.tracks.map((track) => track.id)).toEqual(["mummy"]);
      expect(quick.albums.map((album) => album.id)).toEqual(["mummy-album"]);
      expect(quick.artists).toEqual([{ name: "Мумий Тролль", count: 1 }]);
      expect(quick.genres).toEqual([{ name: "Мумий-рок", count: 1 }]);
    }
  });
  it("uses one search result set for libraries, facets, albums, tracks and folders", () => {
    const catalog = service.catalog;
    const matchingLibrary = catalog.addLibrary(
      "Library Needle",
      path.join(root, "Library Needle"),
    );
    const otherLibrary = catalog.addLibrary(
      "Other library",
      path.join(root, "Other library"),
    );
    const addTrack = (
      id: string,
      libraryId: string,
      title: string,
      albumTitle: string,
      artist: string,
      genre: string,
      relativePath: string,
    ) =>
      catalog.upsert({
        id,
        libraryId,
        relativePath,
        title,
        artists: [artist],
        albumTitle,
        albumArtists: [artist],
        albumKey: `${libraryId}-${id}`,
        genres: [genre],
        year: 2026,
        trackNumber: 1,
        discNumber: 1,
        duration: 60,
        format: "flac",
        size: 1,
        mtimeMs: 1,
        coverId: null,
        available: true,
      });
    addTrack(
      "matching",
      matchingLibrary.id,
      "Track Needle",
      "Album Needle",
      "Artist Needle",
      "Genre Needle",
      path.join("Needle", "Album", "matching.flac"),
    );
    addTrack(
      "other",
      otherLibrary.id,
      "Other track",
      "Other album",
      "Other artist",
      "Other genre",
      path.join("Other", "Album", "other.flac"),
    );

    for (const search of [
      "Library Needle",
      "Genre Needle",
      "Artist Needle",
      "Album Needle",
      "Track Needle",
    ]) {
      const filter = { ...emptyFilter, search };
      expect(catalog.tracks(filter).items.map((track) => track.id)).toEqual([
        "matching",
      ]);
      expect(catalog.albums(filter).total).toBe(1);
      expect(catalog.artists(filter).items).toEqual([
        { name: "Artist Needle", count: 1 },
      ]);
      expect(catalog.genres(filter)).toEqual([
        { name: "Genre Needle", count: 1 },
      ]);
      expect(catalog.libraries(filter).map((library) => library.id)).toEqual([
        matchingLibrary.id,
      ]);
    }
    expect(
      catalog.folders(matchingLibrary.id, null, {
        ...emptyFilter,
        search: "Track Needle",
      }),
    ).toEqual([expect.objectContaining({ name: "Needle", trackCount: 1 })]);
    expect(
      catalog.tracks({
        ...emptyFilter,
        libraryIds: [otherLibrary.id],
        search: "Needle",
      }).total,
    ).toBe(0);
    expect(
      catalog.libraries({
        ...emptyFilter,
        libraryIds: [otherLibrary.id],
        search: "Needle",
      }),
    ).toEqual([]);
    expect(catalog.tracks({ ...emptyFilter, search: "%" }).total).toBe(0);
  });
  it("finds libraries, folders and genres related to selected facets", () => {
    const catalog = service.catalog;
    const first = catalog.addLibrary("First", path.join(root, "First"));
    const second = catalog.addLibrary("Second", path.join(root, "Second"));
    const addTrack = (
      id: string,
      libraryId: string,
      albumKey: string,
      albumArtists: string[],
      genres: string[],
    ) =>
      catalog.upsert({
        id,
        libraryId,
        relativePath:
          id === "artist-track"
            ? path.join("Artist", "Album", `${id}.flac`)
            : `${id}.flac`,
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
    addTrack("other-track", second.id, "other-album", ["Artist C"], ["Jazz"]);

    expect(
      catalog.facetRelevance({
        ...emptyFilter,
        libraryIds: ["ignored-library"],
        genres: ["Jazz"],
        search: "ignored",
        bookmarksOnly: true,
        artists: ["Artist A"],
        albumIds: ["selected-album"],
      }),
    ).toEqual({
      libraryIds: [first.id, second.id].sort(),
      genres: ["", "Jazz", "Rock"],
      folders: [
        { libraryId: first.id, relativePath: "Artist" },
        { libraryId: first.id, relativePath: path.join("Artist", "Album") },
      ],
    });
  });
  it("filters albums by album artists with genre and library intersection", async () => {
    const a = await library("A");
    await library("B");
    const t = tracks().find((t) => t.libraryId !== a.id)!;
    service.catalog.upsert({
      ...t,
      artists: ["Другой исполнитель", "Исполнитель"],
      albumArtists: ["Другой исполнитель альбома", "Исполнитель альбома"],
      genres: ["Jazz"],
    });
    expect(
      service.catalog
        .artists({ ...emptyFilter, genres: ["Jazz"] })
        .items.map((a) => a.name),
    ).toEqual(["Другой исполнитель альбома", "Исполнитель альбома"]);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        artists: ["Другой исполнитель альбома"],
      }).total,
    ).toBe(1);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        artists: ["Другой исполнитель альбома", "Исполнитель альбома"],
      }).total,
    ).toBe(2);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        libraryIds: [a.id],
        artists: ["Другой исполнитель альбома"],
      }).total,
    ).toBe(0);
    expect(
      service.catalog
        .albums({
          ...emptyFilter,
          artists: ["Другой исполнитель альбома"],
        })
        .items.map((album) => album.artists),
    ).toEqual([["Другой исполнитель альбома", "Исполнитель альбома"]]);
  });
  it("migrates fallback artist relations without rescanning", async () => {
    const lib = await library("Downloads");
    const t = tracks().find((track) => track.libraryId === lib.id)!;
    service.catalog.upsert({
      ...t,
      artists: ["Исполнитель трека"],
      albumArtists: [],
    });
    service.catalog.db.prepare("DELETE FROM track_album_artists").run();
    service.catalog.db.pragma("user_version = 5");
    await service.close();
    service = new MusicService(path.join(root, "data"));
    expect(service.catalog.artists(emptyFilter).items).toEqual([
      { name: "Исполнитель трека", count: 1 },
    ]);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        artists: ["Исполнитель трека"],
      }).total,
    ).toBe(1);
    expect(service.catalog.track(t.id)?.albumArtists).toEqual([]);
  });
  it("prevents a second service from mutating the same catalog", () => {
    expect(() => new MusicService(path.join(root, "data"))).toThrow(
      "уже запущен",
    );
  });
  it("scans incrementally, preserves stable IDs, isolates corrupt files, releases folder handles", async () => {
    const lib = await library("Downloads");
    const id = tracks()[0].id;
    await copyFile(
      path.join(fixtures, "broken.mp3"),
      path.join(lib.path, "broken.mp3"),
    );
    service.scan(lib.id);
    await service.idle();
    expect(tracks()).toHaveLength(1);
    expect(tracks()[0].id).toBe(id);
    expect(service.catalog.jobs()[0].errors[0]).toContain("broken.mp3");
    await rename(lib.path, lib.path + "-offline");
    await service.refreshAvailability();
    expect(service.catalog.library(lib.id).available).toBe(false);
    expect(service.catalog.track(id)).toBeDefined();
    expect(tracks()).toHaveLength(0);
    await rename(lib.path + "-offline", lib.path);
    await service.refreshAvailability();
    expect(tracks()).toHaveLength(1);
  });
  it("retries metadata reads outside a worker when its result is unavailable", async () => {
    const lib = await library("Worker retry", "mp3");
    service.workers.run = async () => {
      throw new Error("worker metadata failure");
    };

    service.scan(lib.id, true);
    await service.idle();

    expect(tracks().find((track) => track.libraryId === lib.id)).toMatchObject({
      title: "Первый трек",
      artists: ["Исполнитель"],
    });
    expect(
      service.catalog
        .jobs()
        .find((job) => job.label === "Сканирование: Worker retry")?.errors,
    ).toEqual([]);
  });
  it("falls back to TagLib when music-metadata cannot parse a valid audio file", async () => {
    const file = path.join(fixtures, "sample.mp3");
    const track = await readTrack(
      file,
      "fallback-library",
      fixtures,
      "fallback-track",
      path.join(root, "data"),
      async () => {
        throw new Error(
          "Cannot read properties of undefined (reading 'artists')",
        );
      },
    );

    expect(track).toMatchObject({
      id: "fallback-track",
      title: "Первый трек",
      artists: ["Исполнитель"],
      albumTitle: "Тестовый альбом",
      albumArtists: ["Исполнитель альбома"],
      genres: ["Ambient"],
      year: 2024,
      trackNumber: 1,
      discNumber: 1,
    });
    expect(track.duration).toBeGreaterThan(0);
  });
  it("groups descriptive CD folders into one album while keeping ordinary folders separate", async () => {
    const albumRoot = path.join(root, "descriptive-discs", "Aerial");
    const discOne = path.join(albumRoot, "CD1 - A Sea Of Honey");
    const discTwo = path.join(albumRoot, "CD2 - A Sky Of Honey");
    const bonus = path.join(albumRoot, "Bonus Tracks");
    const sample = path.join(fixtures, "sample.mp3");
    await Promise.all([
      mkdir(discOne, { recursive: true }),
      mkdir(discTwo, { recursive: true }),
      mkdir(bonus, { recursive: true }),
    ]);
    await Promise.all([
      copyFile(sample, path.join(discOne, "01.mp3")),
      copyFile(sample, path.join(discTwo, "01.mp3")),
      copyFile(sample, path.join(bonus, "01.mp3")),
    ]);

    const read = (file: string, id: string) =>
      readTrack(file, "descriptive-discs", root, id, path.join(root, "data"));
    const [firstDisc, secondDisc, bonusTrack] = await Promise.all([
      read(path.join(discOne, "01.mp3"), "disc-one"),
      read(path.join(discTwo, "01.mp3"), "disc-two"),
      read(path.join(bonus, "01.mp3"), "bonus"),
    ]);

    expect(firstDisc.albumKey).toBe(secondDisc.albumKey);
    expect(firstDisc.albumTitle).toBe(secondDisc.albumTitle);
    expect(firstDisc.albumArtists).toEqual(secondDisc.albumArtists);
    expect(bonusTrack.albumKey).not.toBe(firstDisc.albumKey);
  });
  it("retries a transient music-metadata failure before using TagLib", async () => {
    const file = path.join(fixtures, "sample.mp3");
    let calls = 0;
    const track = await readTrack(
      file,
      "retry-library",
      fixtures,
      "retry-track",
      path.join(root, "data"),
      async () => {
        calls++;
        if (calls === 1) throw new Error("transient parser failure");
        return parseFile(file, { duration: true });
      },
    );

    expect(calls).toBe(2);
    expect(track).toMatchObject({
      id: "retry-track",
      title: "Первый трек",
      artists: ["Исполнитель"],
    });
  });
  it("falls back to TagLib when music-metadata returns incomplete metadata", async () => {
    const file = path.join(fixtures, "sample.mp3");
    const track = await readTrack(
      file,
      "fallback-library",
      fixtures,
      "fallback-track",
      path.join(root, "data"),
      async () => ({ format: {} }) as Awaited<ReturnType<typeof parseFile>>,
    );

    expect(track).toMatchObject({
      id: "fallback-track",
      title: "Первый трек",
      artists: ["Исполнитель"],
      albumTitle: "Тестовый альбом",
      albumArtists: ["Исполнитель альбома"],
    });
    expect(track.duration).toBeGreaterThan(0);
  });
  it("rejects overlaps and symlink escapes", async () => {
    const lib = await library("Music");
    await expect(
      service.addLibrary("nested", path.join(lib.path, "Album")),
    ).rejects.toThrow("уже подключены");
    await expect(
      service.safePath(path.join(root, "secret.mp3")),
    ).rejects.toThrow("вне");
    await expect(
      service.addLibrary("data", path.join(root, "data")),
    ).rejects.toThrow("Каталог данных");
  });
  it("filters OR within facets, AND between facets, and supports excluded selections", async () => {
    const a = await library("A");
    const b = await library("B");
    const t = tracks().find((t) => t.libraryId === b.id)!;
    service.catalog.upsert({ ...t, genres: ["Rock", "Pop"] });
    expect(
      service.catalog.tracks({ ...emptyFilter, genres: ["Ambient", "Rock"] })
        .total,
    ).toBe(2);
    expect(
      service.catalog.tracks({
        ...emptyFilter,
        libraryIds: [a.id],
        genres: ["Rock"],
      }).total,
    ).toBe(0);
    expect(
      service.catalog
        .genres({ ...emptyFilter, libraryIds: [b.id] })
        .map((g) => g.name),
    ).toEqual(["Pop", "Rock"]);
    expect(
      service.catalog.selected({
        filter: emptyFilter,
        excludeTrackIds: [t.id],
      }),
    ).toHaveLength(1);
  });
  it("lists folder levels and filters an exact recursive subtree", () => {
    const catalog = service.catalog;
    const lib = catalog.addLibrary("Folders", path.join(root, "Folders"));
    const addTrack = (
      id: string,
      relativePath: string,
      genres: string[] = [],
    ) =>
      catalog.upsert({
        id,
        libraryId: lib.id,
        relativePath,
        title: id,
        artists: ["Artist"],
        albumTitle: id,
        albumArtists: ["Artist"],
        albumKey: id,
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
    addTrack("root", "root.flac");
    addTrack("rock-album", path.join("Rock", "Album", "one.flac"), ["Rock"]);
    addTrack("rock-live", path.join("Rock", "Live", "two.flac"), ["Live"]);
    addTrack("rockabilly", path.join("Rockabilly", "Album", "three.flac"), [
      "Rock",
    ]);
    addTrack("unicode", path.join("Коллекция", "Диск", "track.flac"));
    addTrack("same-name", path.join("Archive", "Album", "track.flac"));

    const rootFolders = catalog.folders(lib.id, null);
    expect(rootFolders.map((folder) => folder.name).sort()).toEqual(
      ["Archive", "Rock", "Rockabilly", "Коллекция"].sort(),
    );
    expect(rootFolders.find((folder) => folder.name === "Rock")).toEqual(
      expect.objectContaining({ trackCount: 2, hasChildren: true }),
    );
    expect(catalog.folders(lib.id, "Rock")).toEqual([
      expect.objectContaining({
        name: "Album",
        trackCount: 1,
        hasChildren: false,
      }),
      expect.objectContaining({
        name: "Live",
        trackCount: 1,
        hasChildren: false,
      }),
    ]);

    const rockFolder = {
      libraryId: lib.id,
      relativePath: "Rock",
    };
    expect(
      catalog
        .tracks({ ...emptyFilter, folders: [rockFolder] })
        .items.map((track) => track.id)
        .sort(),
    ).toEqual(["rock-album", "rock-live"]);
    expect(
      catalog
        .tracks({
          ...emptyFilter,
          folders: [rockFolder],
          genres: ["Rock"],
        })
        .items.map((track) => track.id),
    ).toEqual(["rock-album"]);
    catalog.setBookmark("track", "rock-live", true);
    expect(
      catalog
        .selected({
          filter: {
            ...emptyFilter,
            folders: [rockFolder],
            bookmarksOnly: true,
          },
        })
        .map((track) => track.id),
    ).toEqual(["rock-live"]);
    expect(
      catalog
        .tracks({
          ...emptyFilter,
          folders: [
            rockFolder,
            { libraryId: lib.id, relativePath: path.join("Rock", "Album") },
            { libraryId: lib.id, relativePath: "Archive" },
          ],
        })
        .items.map((track) => track.id)
        .sort(),
    ).toEqual(["rock-album", "rock-live", "same-name"]);

    const other = catalog.addLibrary("Other", path.join(root, "Other"));
    catalog.upsert({
      id: "other-track",
      libraryId: other.id,
      relativePath: path.join("Album", "other.flac"),
      title: "other-track",
      artists: ["Other artist"],
      albumTitle: "Other album",
      albumArtists: ["Other artist"],
      albumKey: "other-album",
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
    expect(
      catalog
        .tracks({
          ...emptyFilter,
          libraryIds: [other.id],
          folders: [rockFolder],
        })
        .items.map((track) => track.id)
        .sort(),
    ).toEqual(["other-track", "rock-album", "rock-live"]);
  });
  it("moves across volumes with original structure, ID and byte identity", async () => {
    const lib = await library("Downloads");
    const track = tracks()[0];
    external = await mkdtemp(path.join(os.tmpdir(), "harbor-player-test-"));
    const dest = (await service.addLibrary("Collection", external)).library;
    await service.idle();
    const before = await readFile(path.join(lib.path, track.relativePath));
    const op = await service.preview("move", { trackIds: [track.id] }, dest.id);
    expect(op.items[0].error).toBeUndefined();
    service.execute(op.id);
    await service.idle();
    const result = service.catalog.operation(op.id);
    expect(result.items[0].phase, result.items[0].error).toBe("done");
    expect(existsSync(path.join(lib.path, track.relativePath))).toBe(false);
    expect(await readFile(path.join(dest.path, track.relativePath))).toEqual(
      before,
    );
    expect(service.catalog.track(track.id)?.libraryId).toBe(dest.id);
  });
  it("moves a selected folder as a complete tree and keeps indexed track IDs", async () => {
    const source = await library("Folder source");
    const track = tracks()[0];
    const empty = path.join(source.path, "Album", "Empty");
    await mkdir(empty);
    await writeFile(path.join(source.path, "Album", "booklet.pdf"), "booklet");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const destinationPath = path.join(root, "Folder destination");
    await mkdir(destinationPath);
    const destination = (
      await service.addLibrary("Folder destination", destinationPath)
    ).library;
    await service.idle();
    const op = await service.preview(
      "move",
      {
        filter: {
          ...emptyFilter,
          folders: [{ libraryId: source.id, relativePath: "Album" }],
        },
      },
      destination.id,
      undefined,
      false,
      {},
      undefined,
      [{ libraryId: source.id, relativePath: "Album" }],
    );
    expect(
      op.items.some((item) => item.directory && item.source.endsWith("Empty")),
    ).toBe(true);
    expect(op.items.some((item) => item.source.endsWith("booklet.pdf"))).toBe(
      true,
    );
    service.execute(op.id);
    await service.idle();
    expect(
      service.catalog.operation(op.id).items.filter((item) => item.error),
    ).toEqual([]);
    expect(
      existsSync(path.join(destination.path, "Album", "booklet.pdf")),
    ).toBe(true);
    expect(existsSync(path.join(destination.path, "Album", "Empty"))).toBe(
      true,
    );
    expect(existsSync(path.join(source.path, "Album"))).toBe(false);
    expect(service.catalog.track(track.id)?.libraryId).toBe(destination.id);
  });
  it("lists every source folder for an artist, including collaboration folders", async () => {
    const lib = await library("Artist folders");
    const first = tracks()[0];
    const secondFile = path.join(lib.path, "Live", "track.flac");
    await mkdir(path.dirname(secondFile), { recursive: true });
    await copyFile(path.join(fixtures, "sample.flac"), secondFile);
    service.catalog.upsert({
      ...first,
      id: "artist-live-track",
      relativePath: path.join("Live", "track.flac"),
      albumKey: "artist-live",
      albumTitle: "Live",
      artists: ["Artist", "Guest"],
      albumArtists: ["Artist", "Guest"],
    });
    service.catalog.upsert({
      ...first,
      artists: ["Artist"],
      albumArtists: ["Artist"],
    });
    expect(service.catalog.artistFolders(["Artist"])).toEqual([
      { libraryId: lib.id, relativePath: "Album", trackCount: 1 },
      { libraryId: lib.id, relativePath: "Live", trackCount: 1 },
    ]);
  });
  it("never overwrites a conflicting target and rejects changes made after preview", async () => {
    const a = await library("Downloads");
    const b = await library("Collection");
    const t = tracks().find((t) => t.libraryId === a.id)!;
    const op = await service.preview("move", { trackIds: [t.id] }, b.id);
    expect(op.items[0].error).toContain("уже есть");
    const trash = await service.preview("trash", { trackIds: [t.id] });
    await writeFile(path.join(a.path, t.relativePath), "externally changed");
    service.execute(trash.id);
    await service.idle();
    expect(service.catalog.operation(trash.id).items[0].error).toContain(
      "изменился",
    );
    expect(await readFile(path.join(a.path, t.relativePath), "utf8")).toBe(
      "externally changed",
    );
  });
  it("deletes into recovery and restores original bytes and catalog entry", async () => {
    const a = await library("Downloads");
    const t = tracks()[0];
    const original = await readFile(path.join(a.path, t.relativePath));
    const op = await service.preview("trash", { trackIds: [t.id] });
    service.execute(op.id);
    await service.idle();
    expect(tracks()).toHaveLength(0);
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(
      service.catalog.operation(restore.id).items[0].error,
    ).toBeUndefined();
    expect(tracks()[0].id).toBe(t.id);
    expect(await readFile(path.join(a.path, t.relativePath))).toEqual(original);
  });
  it("writes tags through verified copies, preserves audio, and restores original bytes", async () => {
    const lib = await library("Music");
    const t = tracks()[0];
    const file = path.join(lib.path, t.relativePath);
    const bytes = await readFile(file);
    const audio = await audioDigest(file);
    const op = await service.preview("tags", { trackIds: [t.id] }, undefined, {
      title: "Новое название",
      genres: ["Jazz", "Ambient"],
    });
    service.execute(op.id);
    await service.idle();
    expect(service.catalog.operation(op.id).items[0].error).toBeUndefined();
    expect((await parseFile(file)).common.title).toBe("Новое название");
    expect(await audioDigest(file)).toBe(audio);
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(
      service.catalog.operation(restore.id).items[0].error,
    ).toBeUndefined();
    expect(await readFile(file)).toEqual(bytes);
  });
  it("uses an injected tag writer without weakening the verified copy workflow", async () => {
    await service.close();
    const calls: { file: string; title: string | undefined }[] = [];
    service = new MusicService(
      path.join(root, "data"),
      {},
      {
        async write(file, patch) {
          calls.push({ file, title: patch.title });
          await writeTagsIsolated(file, patch);
        },
      },
    );
    service.capabilities = {
      writableFormats: ["mp3"],
      verificationDate: new Date().toISOString(),
    };
    const lib = await library("Injected writer", "mp3");
    const track = tracks()[0];
    const operation = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { title: "Injected writer title", genres: ["Injected"] },
    );

    service.execute(operation.id);
    await service.idle();

    expect(calls).toHaveLength(1);
    expect(calls[0].title).toBe("Injected writer title");
    expect(path.basename(calls[0].file)).toMatch(/^\.harbor-player-/);
    expect(service.catalog.track(track.id)?.title).toBe(
      "Injected writer title",
    );
    expect(path.dirname(calls[0].file)).toBe(
      path.dirname(path.join(lib.path, track.relativePath)),
    );
  });
  it("applies a different safe tag patch to every selected track", async () => {
    const lib = await library("Per track", "flac");
    await copyFile(
      path.join(fixtures, "sample.flac"),
      path.join(lib.path, "Album", "second.flac"),
    );
    await service.scan(lib.id, true);
    await service.idle();
    const selected = tracks();
    const patches = Object.fromEntries(
      selected.map((track, index) => [
        track.id,
        { title: `MusicBrainz ${index + 1}`, trackNumber: index + 1 },
      ]),
    );
    const op = await service.preview(
      "tags",
      { trackIds: selected.map((track) => track.id) },
      undefined,
      undefined,
      false,
      patches,
    );
    service.execute(op.id);
    await service.idle();
    expect(
      service.catalog
        .tracks(emptyFilter)
        .items.map((track) => [track.title, track.trackNumber]),
    ).toEqual([
      ["MusicBrainz 1", 1],
      ["MusicBrainz 2", 2],
    ]);
  });
  it("serializes a tag batch in isolated processes and preserves every audio stream", async () => {
    const lib = await library("Music", "mp3");
    const folder = path.join(lib.path, "Album");
    for (let index = 1; index < 10; index++)
      await copyFile(
        path.join(fixtures, "sample.mp3"),
        path.join(folder, `track-${index}.mp3`),
      );
    service.scan(lib.id);
    await service.idle();
    const selected = tracks().filter((track) => track.libraryId === lib.id);
    const audio = new Map(
      await Promise.all(
        selected.map(
          async (track) =>
            [
              track.id,
              await audioDigest(path.join(lib.path, track.relativePath)),
            ] as const,
        ),
      ),
    );
    const op = await service.preview(
      "tags",
      { trackIds: selected.map((t) => t.id) },
      undefined,
      {
        genres: ["Isolated batch"],
      },
    );
    service.execute(op.id);
    await service.idle();
    expect(
      service.catalog
        .operation(op.id)
        .items.every((item) => item.phase === "done"),
    ).toBe(true);
    for (const track of selected)
      expect(await audioDigest(path.join(lib.path, track.relativePath))).toBe(
        audio.get(track.id),
      );
  });
  it("prepares tag previews in selection order and isolates a changed source", async () => {
    const lib = await library("Preview", "mp3");
    const folder = path.join(lib.path, "Album");
    await copyFile(
      path.join(fixtures, "sample.mp3"),
      path.join(folder, "two.mp3"),
    );
    await copyFile(
      path.join(fixtures, "sample.mp3"),
      path.join(folder, "three.mp3"),
    );
    service.scan(lib.id);
    await service.idle();
    const selected = tracks().filter((track) => track.libraryId === lib.id);
    const changed = selected[1];
    await writeFile(path.join(lib.path, changed.relativePath), "external edit");

    const op = await service.preview(
      "tags",
      { trackIds: selected.map((track) => track.id) },
      undefined,
      { genres: ["Preview"] },
    );

    expect(op.items.map((item) => item.trackId)).toEqual(
      selected.map((track) => track.id),
    );
    expect(op.items.filter((item) => item.error)).toEqual([
      expect.objectContaining({
        trackId: changed.id,
        error: expect.stringContaining("изменился"),
      }),
    ]);
  });
  it("rejects a source change made after verification but before backup", async () => {
    const lib = await library("Late source change", "mp3");
    const track = tracks()[0];
    const file = path.join(lib.path, track.relativePath);
    const originalFingerprint = service.fingerprint.bind(service);
    service.fingerprint = async (target, purpose) => {
      const fingerprint = await originalFingerprint(target, purpose);
      if (purpose === "stage") await writeFile(file, "change before backup");
      return fingerprint;
    };
    const op = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { title: "Не должно сохраниться" },
    );
    service.execute(op.id);
    await service.idle();

    const item = service.catalog.operation(op.id).items[0];
    expect(item.error).toContain("изменился");
    expect(await readFile(file, "utf8")).toBe("change before backup");
  });
  it("rejects a source change immediately before atomic tag replacement", async () => {
    const lib = await library("Pre-rename source change", "mp3");
    const track = tracks()[0];
    const file = path.join(lib.path, track.relativePath);
    const originalFingerprint = service.fingerprint.bind(service);
    let sourceChecks = 0;
    service.fingerprint = async (target, purpose) => {
      if (target === file && purpose === "source" && ++sourceChecks === 3)
        await writeFile(file, "change before rename");
      return originalFingerprint(target, purpose);
    };
    const op = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { title: "Не должно сохраниться" },
    );
    service.execute(op.id);
    await service.idle();

    const item = service.catalog.operation(op.id).items[0];
    expect(item.error).toContain("изменился");
    expect(await readFile(file, "utf8")).toBe("change before rename");
  });
  it("resumes copied tag replacements by reindexing without writing the file again", async () => {
    const lib = await library("Music", "mp3");
    const track = tracks()[0];
    const file = path.join(lib.path, track.relativePath);
    const audio = await audioDigest(file);
    const op = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { genres: ["Reconciled"] },
    );
    const upsert = service.catalog.upsert.bind(service.catalog);
    service.catalog.upsert = (() => {
      throw new Error("test catalog failure");
    }) as typeof service.catalog.upsert;
    service.execute(op.id);
    await service.idle();
    const interrupted = service.catalog.operation(op.id);
    expect(interrupted.items[0].phase).toBe("copied");
    expect(interrupted.items[0].error).toContain("Теги записаны");
    const bytesAfterWrite = await readFile(file);
    service.catalog.upsert = upsert;

    const retry = await service.retry(op.id);
    expect(retry.action).toBe("resume");
    await service.idle();
    const completed = service.catalog.operation(op.id);
    expect(completed.items[0].phase).toBe("done");
    expect(completed.items[0].error).toBeUndefined();
    expect(await readFile(file)).toEqual(bytesAfterWrite);
    expect(await audioDigest(file)).toBe(audio);
    expect(service.catalog.track(track.id)?.genres).toEqual(["Reconciled"]);
  });
  it("accepts a timestamp-only source change and creates a fresh retry preview", async () => {
    const lib = await library("Music");
    const track = tracks()[0];
    const file = path.join(lib.path, track.relativePath);
    const original = await readFile(file);
    const timestampOnly = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { title: "По времени" },
    );
    const info = await stat(file);
    await utimes(file, new Date(info.atimeMs), new Date(info.mtimeMs + 60_000));
    service.execute(timestampOnly.id);
    await service.idle();
    expect(service.catalog.operation(timestampOnly.id).items[0].phase).toBe(
      "done",
    );

    const stale = await service.preview(
      "tags",
      { trackIds: [track.id] },
      undefined,
      { title: "Повтор" },
    );
    await writeFile(file, "external edit");
    service.execute(stale.id);
    await service.idle();
    expect(service.catalog.operation(stale.id).items[0].error).toContain(
      "Invalid FLAC preamble",
    );
    await writeFile(file, original);
    const retry = await service.previewRetry(stale.id);
    expect(retry.id).not.toBe(stale.id);
    expect(retry.items[0].error).toBeUndefined();
    service.execute(retry.id);
    await service.idle();
    expect(service.catalog.operation(retry.id).items[0].phase).toBe("done");
  });
  it("blocks unverified formats and preserves source after invalid tag write", async () => {
    const lib = await library("Music");
    const t = tracks()[0];
    service.capabilities.writableFormats = [];
    const blocked = await service.preview(
      "tags",
      { trackIds: [t.id] },
      undefined,
      { title: "No" },
    );
    expect(blocked.items[0].error).toContain("отключена");
    service.capabilities.writableFormats = ["flac"];
    const bytes = await readFile(path.join(lib.path, t.relativePath));
    const op = await service.preview("tags", { trackIds: [t.id] }, undefined, {
      cover: { data: "invalid", mime: "image/png" },
    });
    service.execute(op.id);
    await service.idle();
    // Either a strict writer rejects it or the independent parser rejects the resulting cover.
    expect(await readFile(path.join(lib.path, t.relativePath))).toEqual(bytes);
  });
  it("applies an external cover without requiring a writable tag format", async () => {
    const lib = await library("Music");
    const track = tracks()[0];
    const source = path.join(lib.path, track.relativePath);
    const audioBefore = await readFile(source);
    const cover = await readFile(path.join(fixtures, "cover.png"));
    service.capabilities.writableFormats = [];

    const op = await service.preview(
      "tags",
      { filter: { ...emptyFilter, albumIds: [track.albumKey] } },
      undefined,
      { cover: { data: cover.toString("base64"), mime: "image/png" } },
    );

    expect(op.items).toHaveLength(1);
    expect(op.items[0].error).toBeUndefined();
    service.execute(op.id);
    await service.idle();

    const result = service.catalog.operation(op.id).items[0];
    expect(result.phase).toBe("done");
    expect(result.error).toBeUndefined();
    expect(await readFile(source)).toEqual(audioBefore);
    expect(await readFile(path.join(lib.path, "Album", "cover.png"))).toEqual(
      cover,
    );
    expect(service.catalog.track(track.id)?.coverId).not.toBeNull();
  });
  it("reconciles a verified copied destination after interruption", async () => {
    const lib = await library("Downloads");
    const t = tracks()[0];
    const destFolder = path.join(root, "Collection");
    await mkdir(destFolder);
    const dest = (await service.addLibrary("Collection", destFolder)).library;
    await service.idle();
    const op = await service.preview("move", { trackIds: [t.id] }, dest.id);
    await mkdir(path.dirname(op.items[0].destination), { recursive: true });
    await copyFile(op.items[0].source, op.items[0].destination);
    op.items[0].phase = "prepared";
    op.status = "running";
    service.catalog.saveOperation(op);
    await service.close();
    service = new MusicService(path.join(root, "data"));
    expect(service.catalog.operation(op.id).status).toBe("interrupted");
    service.execute(op.id);
    await service.idle();
    expect(service.catalog.operation(op.id).items[0].error).toBeUndefined();
    expect(service.catalog.track(t.id)?.libraryId).toBe(dest.id);
  });
  it("only moves shared artwork when every track in its folder is selected", async () => {
    const lib = await library("Downloads");
    await copyFile(
      path.join(fixtures, "sample.mp3"),
      path.join(lib.path, "Album", "second.mp3"),
    );
    await copyFile(
      path.join(fixtures, "cover.png"),
      path.join(lib.path, "Album", "cover.png"),
    );
    service.scan(lib.id);
    await service.idle();
    const folder = path.join(root, "Collection");
    await mkdir(folder);
    const target = (await service.addLibrary("Collection", folder)).library;
    await service.idle();
    const one = await service.preview(
      "move",
      { trackIds: [tracks()[0].id] },
      target.id,
      undefined,
      true,
    );
    expect(one.items).toHaveLength(1);
    const all = await service.preview(
      "move",
      { filter: emptyFilter },
      target.id,
      undefined,
      true,
    );
    expect(all.items.filter((i) => i.companion)).toHaveLength(1);
  });
  it("recovers tag replacement committed just before process interruption", async () => {
    const lib = await library("Music");
    const t = tracks()[0];
    const op = await service.preview("tags", { trackIds: [t.id] }, undefined, {
      title: "После сбоя",
    });
    service.execute(op.id);
    await service.idle();
    const completed = service.catalog.operation(op.id);
    expect(completed.items[0].phase).toBe("done");
    completed.items[0].phase = "prepared";
    completed.status = "running";
    service.catalog.saveOperation(completed);
    await service.close();
    service = new MusicService(path.join(root, "data"));
    service.execute(op.id);
    await service.idle();
    expect(service.catalog.operation(op.id).items[0].error).toBeUndefined();
    expect(service.catalog.track(t.id)?.title).toBe("После сбоя");
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(
      (await parseFile(path.join(lib.path, t.relativePath))).common.title,
    ).toBe("Первый трек");
  });
  it("continues a batch after one source changes and refuses to restore over later edits", async () => {
    const a = await library("A");
    await library("B");
    const original = tracks();
    const op = await service.preview(
      "tags",
      { trackIds: original.map((t) => t.id) },
      undefined,
      { title: "Пакетное изменение" },
    );
    const changed = op.items.find((i) => i.source.startsWith(a.path))!;
    await writeFile(changed.source, "external edit");
    service.execute(op.id);
    await service.idle();
    const result = service.catalog.operation(op.id);
    expect(result.items.filter((i) => i.phase === "done")).toHaveLength(1);
    expect(result.items.filter((i) => i.error)).toHaveLength(1);
    const saved = result.items.find((i) => i.phase === "done")!;
    await writeFile(saved.source, "newer external edit");
    const restore = await service.previewRestore(op.id);
    service.execute(restore.id);
    await service.idle();
    expect(service.catalog.operation(restore.id).items[0].error).toContain(
      "изменились",
    );
    expect(await readFile(saved.source, "utf8")).toBe("newer external edit");
  });
});
