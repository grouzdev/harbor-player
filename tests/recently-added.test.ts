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
  root = await mkdtemp(path.resolve(".test-data", "recently-added-"));
  catalog = new Catalog(root);
});

afterEach(async () => {
  catalog.close();
  await rm(root, { recursive: true, force: true });
});

describe("recently added catalog filter", () => {
  it("migrates a v7 catalog without inventing dates for existing tracks", async () => {
    catalog.close();
    const file = path.join(root, "catalog.sqlite");
    const legacy = new Database(file);
    legacy.exec("DROP INDEX tracks_first_indexed_at");
    legacy.exec("ALTER TABLE tracks DROP COLUMN firstIndexedAt");
    legacy.pragma("user_version = 7");
    legacy.close();

    catalog = new Catalog(root);
    const db = (catalog as unknown as { db: Database.Database }).db;
    expect(db.pragma("user_version", { simple: true })).toBe(12);
    expect(
      (db.pragma("table_info(tracks)") as { name: string }[]).map(
        (column) => column.name,
      ),
    ).toContain("firstIndexedAt");
    expect(db.prepare("SELECT firstIndexedAt FROM tracks").all()).toEqual([]);
  });

  it("preserves the first index date through updates and temporary absence", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    const original = track("one", "album", library.id);
    catalog.upsert(original);
    const db = (catalog as unknown as { db: Database.Database }).db;
    const firstIndexedAt = (
      db.prepare("SELECT firstIndexedAt FROM tracks WHERE id='one'").get() as {
        firstIndexedAt: string;
      }
    ).firstIndexedAt;

    catalog.markTrackUnavailable("one");
    catalog.upsert({ ...original, title: "updated", mtimeMs: 2 });

    expect(
      db
        .prepare("SELECT firstIndexedAt,available FROM tracks WHERE id='one'")
        .get(),
    ).toEqual({ firstIndexedAt, available: 1 });
  });

  it("filters new tracks and includes whole albums containing a new track", () => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    catalog.upsert(track("old", "mixed", library.id));
    catalog.upsert(track("recent", "mixed", library.id));
    catalog.upsert(track("new", "new-album", library.id));
    catalog.upsert(track("expired", "old-album", library.id));
    const db = (catalog as unknown as { db: Database.Database }).db;
    const now = Date.now();
    const setDate = db.prepare("UPDATE tracks SET firstIndexedAt=? WHERE id=?");
    setDate.run(new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString(), "old");
    setDate.run(
      new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
      "recent",
    );
    setDate.run(
      new Date(now - 30 * 24 * 60 * 60 * 1000 + 60_000).toISOString(),
      "new",
    );
    setDate.run(
      new Date(now - 30 * 24 * 60 * 60 * 1000 - 60_000).toISOString(),
      "expired",
    );

    const filter = { ...emptyFilter, recentlyAddedDays: 30 as const };
    expect(
      catalog
        .tracks(filter)
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(["new", "old", "recent"]);
    expect(
      catalog
        .albums(filter)
        .items.map((item) => item.id)
        .sort(),
    ).toEqual(["mixed", "new-album"]);
    expect(
      catalog.albums(filter).items.find((item) => item.id === "mixed"),
    ).toMatchObject({ trackCount: 2 });
  });

  it.each([
    [1, 1],
    [3, 2],
    [7, 3],
    [14, 4],
    [30, 5],
  ] as const)("uses the configured %i-day period", (days, expectedCount) => {
    const library = catalog.addLibrary("Library", path.join(root, "music"));
    const db = (catalog as unknown as { db: Database.Database }).db;
    const setDate = db.prepare("UPDATE tracks SET firstIndexedAt=? WHERE id=?");
    const entries = [
      ["day-1", 0.5],
      ["day-3", 2],
      ["day-7", 6],
      ["day-14", 13],
      ["day-30", 29],
    ] as const;
    for (const [id, age] of entries) {
      catalog.upsert(track(id, id, library.id));
      setDate.run(
        new Date(Date.now() - age * 24 * 60 * 60 * 1000).toISOString(),
        id,
      );
    }

    expect(
      catalog.tracks({ ...emptyFilter, recentlyAddedDays: days }).total,
    ).toBe(expectedCount);
  });
});
