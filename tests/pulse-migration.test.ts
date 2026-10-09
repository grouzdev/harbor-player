import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, cpSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { Catalog } from "../dist/server/database.js";
import { runCatalogMigrations } from "../dist/server/catalog-migrations.js";

// Provenance: actual parent of b309473 (first Pulse/v13 commit).
// Export its server/shared sources with git show, compile with the installed TS,
// then invoke that revision's Catalog/addLibrary/upsert/createPlaylist/saveQueue.
// The database contains invented metadata only, no user database or real audio.
// Closing the old Catalog checkpoints WAL before copying. All source/build/SQLite
// artifacts stay beneath worktree/.test-data and are removed after the suite.
// Requires this revision's Git object: shallow exports must fetch it explicitly.
// This is an old-code synthetic fixture, not evidence about a user's live v12 DB.
const revision = "72403c6c820d0f81cf071db135105e00638f81f8";
let root: string;
let fixture: string;
let baseline: ReturnType<typeof snapshot>;
let baselineSchema: unknown;
const snapshot = (db: Database.Database) => {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'pulse_%' ORDER BY name",
    )
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ]),
  );
};
const check = (db: Database.Database, version: number) => {
  expect(db.pragma("user_version", { simple: true })).toBe(version);
  expect(db.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(snapshot(db)).toEqual(baseline);
  expect(
    db
      .prepare(
        "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name NOT LIKE 'pulse_%' ORDER BY type,name",
      )
      .all(),
  ).toEqual(baselineSchema);
};

beforeAll(() => {
  mkdirSync(".test-data", { recursive: true });
  root = mkdtempSync(path.resolve(".test-data", "pulse-v12-"));
  const source = path.join(root, "old");
  // Export tracked source only. Never check out or edit another working tree.
  const files = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", revision, "src/server", "src/shared"],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n");
  for (const file of files) {
    const target = path.join(source, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, execFileSync("git", ["show", `${revision}:${file}`]));
  }
  const migrations = execFileSync(
    "git",
    ["show", `${revision}:src/server/catalog-migrations.ts`],
    { encoding: "utf8" },
  );
  expect(migrations).toContain("user_version = 12");
  expect(migrations).not.toContain("user_version = 13");
  writeFileSync(
    path.join(source, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        rootDir: "src",
        outDir: "dist",
        types: ["node"],
      },
      include: ["src/server", "src/shared"],
    }),
  );
  execFileSync(
    process.execPath,
    [
      path.resolve("node_modules/typescript/bin/tsc"),
      "-p",
      path.join(source, "tsconfig.json"),
    ],
    { stdio: "pipe" },
  );
  fixture = path.join(root, "fixture");
  const script = `
import { Catalog } from "./dist/server/database.js";
const c = new Catalog(${JSON.stringify(fixture)});
const library = c.addLibrary("Synthetic v12", ${JSON.stringify(path.join(root, "music"))});
c.upsert({id:"song",libraryId:library.id,relativePath:"Artist/Album/song.flac",title:"Synthetic song",artists:["Synthetic artist"],albumTitle:"Synthetic album",albumArtists:["Synthetic artist"],albumKey:"synthetic-album",rating:null,albumRating:null,albumViewed:false,genres:["Test"],year:2026,trackNumber:1,discNumber:null,duration:10,format:"flac",size:1,mtimeMs:1,coverId:null,available:true});
const p = c.createPlaylist("Synthetic playlist");
const detail = c.addPlaylistEntries(p.playlist.id, "track", ["song"]);
c.saveQueue("synthetic-queue","2026-01-01T00:00:00Z",["song"],{playlistId:p.playlist.id,entryIds:detail.entries.map(e=>e.id)});
c.close();
`;
  writeFileSync(path.join(source, "create.mjs"), script);
  execFileSync(process.execPath, [path.join(source, "create.mjs")], {
    stdio: "pipe",
  });
  const db = new Database(path.join(fixture, "catalog.sqlite"));
  expect(db.pragma("user_version", { simple: true })).toBe(12);
  expect(
    db
      .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'pulse_%'")
      .all(),
  ).toEqual([]);
  baseline = snapshot(db);
  baselineSchema = db
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE tbl_name NOT LIKE 'pulse_%' ORDER BY type,name",
    )
    .all();
  check(db, 12);
  db.close(); // Closed old Catalog: WAL safely checkpointed, no live-file copy.
}, 120000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("real old-code v12 → v13 migration", () => {
  it("preserves every catalog row, playlist and queue over two opens", () => {
    const target = path.join(root, "upgrade");
    cpSync(fixture, target, { recursive: true });
    let pulseBaseline: unknown;
    for (let i = 0; i < 2; i++) {
      const catalog = new Catalog(target);
      try {
        const db = (catalog as unknown as { db: Database.Database }).db;
        check(db, 13);
        const settings = db.prepare("SELECT * FROM pulse_settings").all();
        if (i === 0) pulseBaseline = settings;
        else expect(settings).toEqual(pulseBaseline);
        expect(
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'pulse_%'",
            )
            .all(),
        ).toHaveLength(9);
        expect(catalog.playlistTrackIds(catalog.playlists()[0].id)).toEqual([
          "song",
        ]);
        expect(catalog.queueTrackIds("synthetic-queue")).toEqual(["song"]);
        expect(catalog.track("song")).toMatchObject({
          title: "Synthetic song",
          available: true,
        });
      } finally {
        catalog.close();
      }
    }
  });

  it("rolls back DDL and user_version on a fault inside v13, then retries", () => {
    const target = path.join(root, "fault");
    cpSync(fixture, target, { recursive: true });
    const db = new Database(path.join(target, "catalog.sqlite"));
    const original = db.exec.bind(db);
    db.exec = ((sql: string) => {
      const result = original(sql);
      if (sql.includes("CREATE TABLE IF NOT EXISTS pulse_settings"))
        throw new Error("injected v13 DDL fault");
      return result;
    }) as typeof db.exec;
    try {
      expect(() => runCatalogMigrations(db)).toThrow("injected v13 DDL fault");
      check(db, 12);
      expect(
        db
          .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'pulse_%'")
          .all(),
      ).toEqual([]);
    } finally {
      db.exec = original;
      db.close();
    }
    const catalog = new Catalog(target);
    try {
      check((catalog as unknown as { db: Database.Database }).db, 13);
    } finally {
      catalog.close();
    }
  });
});
