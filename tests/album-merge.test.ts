import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { Catalog } from "../dist/server/database.js";
import { MusicService } from "../dist/server/service.js";
import { emptyFilter, type Track } from "../src/shared/contracts.js";
import {
  albumIdentityKey,
  normalizedAlbumFolder,
} from "../src/server/album-identity.js";

let root: string | undefined;
let catalog: Catalog | undefined;
let service: MusicService | undefined;

afterEach(async () => {
  catalog?.close();
  catalog = undefined;
  await service?.close();
  service = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function track(
  libraryId: string,
  id: string,
  relativePath: string,
  albumKey: string,
  albumTitle = "Album",
  year: number | null = 2020,
): Track {
  return {
    id,
    libraryId,
    relativePath,
    title: id,
    artists: ["Track artist"],
    albumTitle,
    albumArtists: ["Album artist"],
    albumKey,
    genres: ["Rock"],
    year,
    trackNumber: 1,
    discNumber: 1,
    duration: 1,
    format: "flac",
    size: 1,
    mtimeMs: 1,
    coverId: null,
    available: true,
  };
}

describe("album identity", () => {
  it("normalizes disc folders and keeps an explicit zero year distinct", () => {
    expect(
      normalizedAlbumFolder(path.join("Artist", "Album", "CD1", "01.flac")),
    ).toBe(path.join("Artist", "Album"));
    const common = {
      libraryId: "library",
      relativePath: path.join("Artist", "Album", "01.flac"),
      albumTitle: "Album",
      albumArtists: ["Artist"],
    };
    expect(albumIdentityKey({ ...common, year: null })).not.toBe(
      albumIdentityKey({ ...common, year: 0 }),
    );
  });

  it("migrates MusicBrainz-split albums and deduplicates their bookmarks", async () => {
    root = await mkdtemp(path.resolve(".test-data", "album-identity-"));
    catalog = new Catalog(root);
    const library = catalog.addLibrary("Library", root);
    catalog.upsert(
      track(
        library.id,
        "first",
        path.join("Artist", "Album", "CD1", "01.flac"),
        "old-release-a",
      ),
    );
    catalog.upsert(
      track(
        library.id,
        "second",
        path.join("Artist", "Album", "CD2", "02.flac"),
        "old-release-b",
      ),
    );
    catalog.setBookmark("album", "old-release-a", true);
    catalog.setBookmark("album", "old-release-b", true);
    const db = (catalog as unknown as { db: Database.Database }).db;
    db.pragma("user_version = 6");
    catalog.close();
    catalog = new Catalog(root);

    const newKey = albumIdentityKey({
      libraryId: library.id,
      relativePath: path.join("Artist", "Album", "CD1", "01.flac"),
      albumTitle: "Album",
      albumArtists: ["Album artist"],
      year: 2020,
    });
    expect(
      catalog.tracks(emptyFilter).items.map((item) => item.albumKey),
    ).toEqual([newKey, newKey]);
    expect(catalog.bookmarks()).toContainEqual({ kind: "album", id: newKey });
    expect(
      catalog.bookmarks().filter((item) => item.kind === "album"),
    ).toHaveLength(1);
  });
});

describe("album merge context and execution guard", () => {
  it("reports exact sources and blocks different normalized folders", async () => {
    root = await mkdtemp(path.resolve(".test-data", "album-context-"));
    catalog = new Catalog(root);
    const library = catalog.addLibrary("Library", root);
    const first = "first-album";
    const second = "second-album";
    catalog.upsert(
      track(
        library.id,
        "first",
        path.join("Artist", "Album", "CD1", "01.flac"),
        first,
      ),
    );
    catalog.upsert(
      track(
        library.id,
        "second",
        path.join("Artist", "Album", "CD2", "02.flac"),
        second,
        "Other album",
      ),
    );

    expect(catalog.albumMergeContext([first, second])).toMatchObject({
      compatible: true,
      trackCount: 2,
      relativeFolder: path.join("Artist", "Album"),
      sources: [
        { albumId: first, title: "Album", trackCount: 1 },
        { albumId: second, title: "Other album", trackCount: 1 },
      ],
    });

    catalog.upsert(
      track(
        library.id,
        "second",
        path.join("Artist", "Elsewhere", "02.flac"),
        second,
        "Other album",
      ),
    );
    expect(catalog.albumMergeContext([first, second])).toMatchObject({
      compatible: false,
      blockers: [expect.stringContaining("разных библиотеках или папках")],
    });
    expect(() => catalog!.albumMergeContext([first, first])).toThrow(
      "как минимум два разных",
    );
  });

  it("does not allow an errored merge preview to execute partially", async () => {
    root = await mkdtemp(path.resolve(".test-data", "album-preview-"));
    service = new MusicService(path.join(root, "data"));
    service.capabilities = {
      writableFormats: ["flac"],
      verificationDate: new Date().toISOString(),
    };
    const library = service.catalog.addLibrary("Library", root);
    service.catalog.upsert(
      track(library.id, "first", "Album/01.flac", "first-album"),
    );
    service.catalog.upsert(
      track(
        library.id,
        "second",
        "Album/02.flac",
        "second-album",
        "Other album",
      ),
    );

    const preview = await service.preview(
      "tags",
      { filter: { ...emptyFilter, albumIds: ["first-album", "second-album"] } },
      undefined,
      { albumTitle: "Merged", albumArtists: ["Artist"], year: 2024 },
      false,
      {},
      undefined,
      undefined,
      "album-merge",
    );
    expect(preview.intent).toBe("album-merge");
    expect(preview.items.some((item) => item.error)).toBe(true);
    expect(() => service!.execute(preview.id)).toThrow("нельзя запустить");
  });
});
