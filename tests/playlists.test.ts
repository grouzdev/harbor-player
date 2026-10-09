import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Catalog } from "../dist/server/database.js";
import type { Track } from "../src/shared/contracts.js";
import {
  parsePlaylistFile,
  writePlaylistFile,
} from "../dist/server/playlist-formats.js";
import { renderTrackPath } from "../dist/server/playlist-paths.js";

let root: string;
let catalog: Catalog;

const makeTrack = (
  id: string,
  libraryId: string,
  options: Partial<Track> = {},
): Track => ({
  id,
  libraryId,
  relativePath: `Artist/Album/${id}.flac`,
  title: id,
  artists: ["Artist"],
  albumTitle: "Album",
  albumArtists: ["Artist"],
  albumKey: "album",
  rating: null,
  albumRating: null,
  albumViewed: false,
  genres: [],
  year: null,
  trackNumber: 1,
  discNumber: null,
  duration: 10,
  format: "flac",
  size: 1,
  mtimeMs: 1,
  coverId: null,
  available: true,
  ...options,
});

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "playlists-"));
  catalog = new Catalog(root);
});

afterEach(async () => {
  catalog.close();
  await rm(root, { recursive: true, force: true });
});

describe("playlists", () => {
  it("creates descriptive snapshots for every playlist entry kind", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(
      makeTrack("song", library.id, {
        relativePath: path.join("Artist", "Album", "song.flac"),
        title: "Song",
        albumTitle: "Album",
        albumKey: "album",
        artists: ["Artist"],
        albumArtists: ["Artist"],
        genres: ["Rock", "Electronic"],
        coverId: "album-cover.jpg",
      }),
    );
    const playlist = catalog.createPlaylist("Descriptions");
    const folder = catalog.playlistFolderTargetId(
      library.id,
      path.join("Artist", "Album"),
    );

    const detail = catalog.addPlaylistEntries(playlist.playlist.id, "track", [
      "song",
    ]);
    catalog.addPlaylistEntries(playlist.playlist.id, "album", ["album"]);
    catalog.addPlaylistEntries(playlist.playlist.id, "artist", ["Artist"]);
    catalog.addPlaylistEntries(playlist.playlist.id, "genre", ["Rock"]);
    const completed = catalog.addPlaylistEntries(
      playlist.playlist.id,
      "folder",
      [folder],
    );

    expect(detail.entries[0].snapshot).toEqual({
      title: "Song",
      subtitle: "Artist",
      coverId: "album-cover.jpg",
    });
    expect(completed.entries.map((entry) => entry.snapshot)).toEqual([
      { title: "Song", subtitle: "Artist", coverId: "album-cover.jpg" },
      { title: "Album", subtitle: "Artist", coverId: "album-cover.jpg" },
      {
        title: "Artist",
        subtitle: "Electronic · Rock",
        coverId: "album-cover.jpg",
      },
      {
        title: "Rock",
        subtitle: path.join(root, "music", "Artist", "Album"),
        coverId: "album-cover.jpg",
      },
      {
        title: "Album",
        subtitle: path.join(root, "music", "Artist", "Album"),
        coverId: "album-cover.jpg",
      },
    ]);
  });

  it("refreshes playlist entry tiles from the current catalog", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(
      makeTrack("song", library.id, {
        relativePath: path.join("Artist", "Album", "song.flac"),
        title: "Original song",
        albumTitle: "Original album",
        albumKey: "album",
        artists: ["Artist"],
        albumArtists: ["Artist"],
        genres: ["Rock"],
      }),
    );
    const playlist = catalog.createPlaylist("Live tiles");
    const folder = catalog.playlistFolderTargetId(
      library.id,
      path.join("Artist", "Album"),
    );
    catalog.addPlaylistEntries(playlist.playlist.id, "track", ["song"]);
    catalog.addPlaylistEntries(playlist.playlist.id, "album", ["album"]);
    catalog.addPlaylistEntries(playlist.playlist.id, "artist", ["Artist"]);
    catalog.addPlaylistEntries(playlist.playlist.id, "genre", ["Rock"]);
    catalog.addPlaylistEntries(playlist.playlist.id, "folder", [folder]);

    catalog.upsert(
      makeTrack("song", library.id, {
        relativePath: path.join("Artist", "Album", "song.flac"),
        title: "Current song",
        albumTitle: "Current album",
        albumKey: "album",
        artists: ["Artist"],
        albumArtists: ["Artist"],
        genres: ["Electronic"],
        coverId: "current-cover.jpg",
      }),
    );

    expect(
      catalog
        .playlist(playlist.playlist.id)
        .entries.map((entry) => entry.snapshot),
    ).toEqual([
      {
        title: "Current song",
        subtitle: "Artist",
        coverId: "current-cover.jpg",
      },
      {
        title: "Current album",
        subtitle: "Artist",
        coverId: "current-cover.jpg",
      },
      {
        title: "Artist",
        subtitle: "Electronic",
        coverId: "current-cover.jpg",
      },
      { title: "Rock", subtitle: "Нет доступных папок", coverId: null },
      {
        title: "Album",
        subtitle: path.join(root, "music", "Artist", "Album"),
        coverId: "current-cover.jpg",
      },
    ]);
  });

  it("keeps live genre blocks, preserves overlaps and reorders blocks", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(makeTrack("one", library.id, { trackNumber: 1 }));
    catalog.upsert(makeTrack("two", library.id, { trackNumber: 2 }));
    const created = catalog.createPlaylist("В плеер");
    catalog.addPlaylistEntries(created.playlist.id, "genre", ["Rock"]);
    catalog.upsert(
      makeTrack("one", library.id, { trackNumber: 1, genres: ["Rock"] }),
    );
    catalog.upsert(
      makeTrack("two", library.id, { trackNumber: 2, genres: ["Rock"] }),
    );
    const detail = catalog.addPlaylistEntries(created.playlist.id, "album", [
      "album",
    ]);

    expect(detail.playlist.trackCount).toBe(4);
    expect(detail.entries.map((entry) => entry.resolvedCount)).toEqual([2, 2]);
    expect(
      catalog
        .playlistTracks(created.playlist.id)
        .items.map((item) => item.track.id),
    ).toEqual(["one", "two", "one", "two"]);

    const reordered = catalog.reorderPlaylistEntries(created.playlist.id, [
      detail.entries[1].id,
      detail.entries[0].id,
    ]);
    expect(reordered.entries.map((entry) => entry.kind)).toEqual([
      "album",
      "genre",
    ]);
  });

  it("keeps the manually added order", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(
      makeTrack("late-year", library.id, {
        albumTitle: "Beta",
        albumKey: "beta",
        year: 2030,
        trackNumber: 2,
      }),
    );
    catalog.upsert(
      makeTrack("early-year", library.id, {
        albumTitle: "Alpha",
        albumKey: "alpha",
        year: 1980,
        trackNumber: 1,
      }),
    );
    const created = catalog.createPlaylist("Ручной");
    catalog.addPlaylistEntries(created.playlist.id, "track", [
      "late-year",
      "early-year",
    ]);
    expect(
      catalog
        .playlistTracks(created.playlist.id)
        .items.map((item) => item.track.id),
    ).toEqual(["late-year", "early-year"]);
  });

  it("keeps folder entries live, recursive and repeatable within a playlist", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(
      makeTrack("root", library.id, {
        relativePath: path.join("Selected", "root.flac"),
      }),
    );
    catalog.upsert(
      makeTrack("nested", library.id, {
        relativePath: path.join("Selected", "Nested", "nested.flac"),
      }),
    );
    catalog.upsert(
      makeTrack("other", library.id, {
        relativePath: path.join("Other", "other.flac"),
      }),
    );
    const created = catalog.createPlaylist("Папка");
    const target = catalog.playlistFolderTargetId(library.id, "Selected");
    const initial = catalog.addPlaylistEntries(created.playlist.id, "folder", [
      target,
    ]);

    expect(initial.entries[0]).toMatchObject({
      kind: "folder",
      snapshot: {
        title: "Selected",
        subtitle: path.join(root, "music", "Selected"),
      },
    });
    expect(
      catalog
        .playlistTracks(created.playlist.id)
        .items.map((item) => item.track.id),
    ).toEqual(["nested", "root"]);

    catalog.upsert(
      makeTrack("later", library.id, {
        relativePath: path.join("Selected", "Later", "later.flac"),
      }),
    );
    expect(catalog.playlist(created.playlist.id).playlist.trackCount).toBe(3);

    const repeated = catalog.addPlaylistEntries(created.playlist.id, "folder", [
      target,
    ]);
    expect(repeated.entries).toHaveLength(2);
    expect(repeated.playlist.trackCount).toBe(6);
  });

  it("keeps a library root entry live", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(
      makeTrack("root-track", library.id, {
        relativePath: path.join("Artist", "root.flac"),
      }),
    );
    const created = catalog.createPlaylist("Корень");
    const target = catalog.playlistFolderTargetId(library.id, "");

    const initial = catalog.addPlaylistEntries(created.playlist.id, "folder", [
      target,
    ]);
    expect(initial.entries[0]).toMatchObject({
      kind: "folder",
      snapshot: { title: "Library", subtitle: path.join(root, "music") },
    });
    expect(catalog.playlistTracks(created.playlist.id).items).toHaveLength(1);

    catalog.upsert(
      makeTrack("new-track", library.id, {
        relativePath: path.join("Later", "new.flac"),
      }),
    );
    expect(catalog.playlist(created.playlist.id).playlist.trackCount).toBe(2);
    expect(
      catalog.addPlaylistEntries(created.playlist.id, "folder", [target])
        .entries,
    ).toHaveLength(2);
    expect(catalog.playlist(created.playlist.id).playlist.trackCount).toBe(4);
  });

  it("preserves existing playlist entries during the folder migration", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(makeTrack("one", library.id));
    const created = catalog.createPlaylist("Legacy");
    catalog.addPlaylistEntries(created.playlist.id, "track", ["one"]);
    catalog.saveQueue("legacy-queue", new Date().toISOString(), ["one"]);
    catalog.close();

    const db = new Database(path.join(root, "catalog.sqlite"));
    db.exec(`
      CREATE TABLE playlist_entries_legacy (
        id TEXT PRIMARY KEY, playlistId TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK(kind IN ('genre','artist','album','track')), targetId TEXT NOT NULL,
        position INTEGER NOT NULL, snapshot TEXT NOT NULL
      );
      INSERT INTO playlist_entries_legacy SELECT id,playlistId,kind,targetId,position,snapshot FROM playlist_entries;
      DROP TABLE playlist_entries;
      ALTER TABLE playlist_entries_legacy RENAME TO playlist_entries;
      CREATE INDEX playlist_entries_order ON playlist_entries(playlistId,position,id);
      ALTER TABLE queues DROP COLUMN playlistId;
      ALTER TABLE queues DROP COLUMN entryIds;
    `);
    db.pragma("user_version = 10");
    db.close();

    catalog = new Catalog(root);
    expect(catalog.queueSnapshot("legacy-queue")).toEqual({
      trackIds: ["one"],
    });
    expect(
      catalog.playlist(created.playlist.id).entries.map((entry) => entry.kind),
    ).toEqual(["track"]);
    expect(
      (catalog as unknown as { db: Database.Database }).db.pragma(
        "user_version",
        { simple: true },
      ),
    ).toBe(13);
  });

  it("retains unavailable entries and reports them", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(makeTrack("one", library.id));
    const created = catalog.createPlaylist("Недоступный");
    catalog.addPlaylistEntries(created.playlist.id, "track", ["one"]);
    catalog.markTrackUnavailable("one");

    expect(catalog.playlist(created.playlist.id).playlist).toMatchObject({
      trackCount: 1,
      unavailableCount: 1,
    });
    expect(catalog.playlistTrackIds(created.playlist.id)).toEqual([]);
  });

  it("keeps dynamic entries live when their tracks become unavailable", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(
      makeTrack("album-track", library.id, {
        albumKey: "live-album",
        albumTitle: "Live album",
      }),
    );
    catalog.upsert(
      makeTrack("artist-track", library.id, {
        albumKey: "artist-album",
        artists: ["Live artist"],
        albumArtists: ["Live artist"],
      }),
    );
    catalog.upsert(
      makeTrack("genre-track", library.id, {
        albumKey: "genre-album",
        genres: ["Live genre"],
      }),
    );
    catalog.upsert(
      makeTrack("folder-track", library.id, {
        albumKey: "folder-album",
        relativePath: path.join("Selected", "folder-track.flac"),
      }),
    );
    const folder = catalog.playlistFolderTargetId(library.id, "Selected");
    const created = catalog.createPlaylist("Живой");
    catalog.addPlaylistEntries(created.playlist.id, "album", ["live-album"]);
    catalog.addPlaylistEntries(created.playlist.id, "artist", ["Live artist"]);
    catalog.addPlaylistEntries(created.playlist.id, "genre", ["Live genre"]);
    catalog.addPlaylistEntries(created.playlist.id, "folder", [folder]);

    ["album-track", "artist-track", "genre-track", "folder-track"].forEach(
      (id) => catalog.markTrackUnavailable(id),
    );

    const detail = catalog.playlist(created.playlist.id);
    expect(detail.playlist).toMatchObject({
      trackCount: 0,
      unavailableCount: 0,
    });
    expect(detail.entries).toHaveLength(4);
    expect(
      detail.entries.map((entry) => ({
        resolvedCount: entry.resolvedCount,
        unavailableCount: entry.unavailableCount,
      })),
    ).toEqual([
      { resolvedCount: 0, unavailableCount: 0 },
      { resolvedCount: 0, unavailableCount: 0 },
      { resolvedCount: 0, unavailableCount: 0 },
      { resolvedCount: 0, unavailableCount: 0 },
    ]);
    expect(catalog.playlistTracks(created.playlist.id).items).toEqual([]);
    expect(catalog.playlistTrackIds(created.playlist.id)).toEqual([]);

    catalog.upsert(
      makeTrack("artist-returned", library.id, {
        albumKey: "artist-returned-album",
        artists: ["Live artist"],
        albumArtists: ["Live artist"],
      }),
    );
    expect(catalog.playlist(created.playlist.id).playlist.trackCount).toBe(1);
  });

  it("renders safe reusable paths and reads/writes common formats", async () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    const track = makeTrack("one", library.id, {
      albumArtists: ["CON"],
      albumTitle: "A: B",
      relativePath: "source/01 song.flac",
    });
    catalog.upsert(track);
    const template = catalog.pathTemplate("default-album-artist");
    expect(renderTrackPath(template, track)).toBe(
      path.join("_CON", "A_ B", "01 song.flac"),
    );

    const m3u = writePlaylistFile("m3u8", "Test", [
      { track, file: track.relativePath, relative: true },
    ]);
    const m3uPath = path.join(root, "list.m3u8");
    await writeFile(m3uPath, m3u, "utf8");
    expect(await parsePlaylistFile(m3uPath)).toEqual([
      path.resolve(root, track.relativePath),
    ]);

    const xspfPath = path.join(root, "list.xspf");
    await writeFile(
      xspfPath,
      writePlaylistFile("xspf", "Test", [
        { track, file: track.relativePath, relative: true },
      ]),
      "utf8",
    );
    expect(await parsePlaylistFile(xspfPath)).toEqual([
      path.resolve(root, track.relativePath),
    ]);
  });
});
