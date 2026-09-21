import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import { Catalog } from "../dist/server/database.js";
import { emptyFilter, type Track } from "../src/shared/contracts.js";

let root: string;
let catalog: Catalog;

const track = (id: string, albumKey: string, libraryId: string): Track => ({
  id,
  libraryId,
  relativePath: `${albumKey}/${id}.flac`,
  title: id,
  artists: ["Artist"],
  albumTitle: albumKey,
  albumArtists: ["Artist"],
  albumKey,
  rating: null,
  albumRating: null,
  albumViewed: false,
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

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "user-state-"));
  catalog = new Catalog(root);
});

afterEach(async () => {
  catalog.close();
  await rm(root, { recursive: true, force: true });
});

describe("catalog user state", () => {
  it("stores independent ratings, removes defaults, and survives reopening", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(track("one", "album", library.id));
    catalog.setUserState("album", ["album"], { rating: 4, viewed: true });
    catalog.setUserState("track", ["one"], { rating: 2 });

    expect(catalog.track("one")).toMatchObject({
      rating: 2,
      albumRating: 4,
      albumViewed: true,
    });
    expect(catalog.albums(emptyFilter).items[0]).toMatchObject({
      rating: 4,
      viewed: true,
    });

    catalog.close();
    catalog = new Catalog(root);
    expect(catalog.track("one")).toMatchObject({
      rating: 2,
      albumRating: 4,
      albumViewed: true,
    });
    catalog.setUserState("track", ["one"], { rating: null });
    catalog.setUserState("album", ["album"], { rating: null, viewed: false });
    const db = (catalog as unknown as { db: Database.Database }).db;
    expect(db.prepare("SELECT * FROM catalog_user_state").all()).toEqual([]);
  });

  it("validates the whole batch before writing and rejects viewed tracks", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(track("one", "album", library.id));
    expect(() =>
      catalog.setUserState("track", ["one", "missing"], { rating: 5 }),
    ).toThrow("не найден");
    expect(catalog.track("one")?.rating).toBeNull();
    expect(() =>
      catalog.setUserState("track", ["one"], { viewed: true }),
    ).toThrow("только для альбомов");
  });

  it("supports open ranges, unrated unions, and viewed states per panel", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(track("one", "a", library.id));
    catalog.upsert(track("two", "b", library.id));
    catalog.upsert(track("three", "c", library.id));
    catalog.setUserState("album", ["a"], { rating: 2, viewed: true });
    catalog.setUserState("album", ["b"], { rating: 5 });
    catalog.setUserState("track", ["one"], { rating: 3 });
    catalog.setUserState("track", ["two"], { rating: 5 });

    expect(
      catalog
        .albums({ ...emptyFilter, albumRatingMin: 4 })
        .items.map((x) => x.id),
    ).toEqual(["b"]);
    expect(
      catalog
        .albums({ ...emptyFilter, albumRatingMax: 2, albumUnrated: true })
        .items.map((x) => x.id)
        .sort(),
    ).toEqual(["a", "c"]);
    expect(
      catalog
        .albums({ ...emptyFilter, albumViewed: "viewed" })
        .items.map((x) => x.id),
    ).toEqual(["a"]);
    expect(
      catalog
        .tracks({ ...emptyFilter, trackRatingMin: 4, trackUnrated: true })
        .items.map((x) => x.id)
        .sort(),
    ).toEqual(["three", "two"]);
    expect(catalog.albums({ ...emptyFilter, trackRatingMin: 5 }).total).toBe(3);
    expect(catalog.tracks({ ...emptyFilter, albumRatingMin: 5 }).total).toBe(3);
  });

  it("copies album state on an internal album-key change without overwriting the destination", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    const original = track("one", "old", library.id);
    catalog.upsert(original);
    catalog.setUserState("album", ["old"], { rating: 4, viewed: true });
    catalog.upsert({ ...original, albumKey: "new", albumTitle: "new" });
    expect(catalog.track("one")).toMatchObject({
      albumRating: 4,
      albumViewed: true,
    });

    catalog.upsert(track("two", "target", library.id));
    catalog.setUserState("album", ["target"], { rating: 2 });
    catalog.upsert({ ...original, albumKey: "target", albumTitle: "target" });
    expect(catalog.track("one")?.albumRating).toBe(2);
    const db = (catalog as unknown as { db: Database.Database }).db;
    expect(
      db
        .prepare(
          "SELECT rating FROM catalog_user_state WHERE kind='album' AND id='old'",
        )
        .get(),
    ).toEqual({ rating: 4 });
  });

  it("keeps state for temporary unavailability and removes only library orphans", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(track("one", "album", library.id));
    catalog.setUserState("track", ["one"], { rating: 5 });
    catalog.setUserState("album", ["album"], { viewed: true });
    catalog.markTrackUnavailable("one");
    const db = (catalog as unknown as { db: Database.Database }).db;
    expect(
      db.prepare("SELECT count(*) count FROM catalog_user_state").get(),
    ).toEqual({ count: 2 });
    catalog.removeLibrary(library.id);
    expect(
      db.prepare("SELECT count(*) count FROM catalog_user_state").get(),
    ).toEqual({ count: 0 });
  });

  it("creates the v7 table for a v6 database and enforces constraints", () => {
    catalog.close();
    const file = path.join(root, "catalog.sqlite");
    const db = new Database(file);
    db.exec("DROP TABLE catalog_user_state");
    db.pragma("user_version = 6");
    db.close();
    catalog = new Catalog(root);
    const migrated = (catalog as unknown as { db: Database.Database }).db;
    expect(migrated.pragma("user_version", { simple: true })).toBe(7);
    expect(() =>
      migrated
        .prepare("INSERT INTO catalog_user_state VALUES ('track','x',6,0)")
        .run(),
    ).toThrow();
    expect(() =>
      migrated
        .prepare("INSERT INTO catalog_user_state VALUES ('track','x',1,1)")
        .run(),
    ).toThrow();
  });
});
